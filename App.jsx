import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import Tesseract from 'tesseract.js';

const THIS_YEAR = new Date().getFullYear();
const DEFAULT_CATEGORIES = [
  { id:'alternativmedizin', name:'Alternativmedizin', icon:'🧘‍♂️', coverage:0.8, budgetCHF:2500, period:'yearly', reference:"Beilagen S.8 (80% bis CHF 2'500)"},
  { id:'gesundheitsfoerderung', name:'Gesundheitsförderung', icon:'🏋️', coverage:0.5, budgetCHF:400, period:'yearly', reference:"Beilagen S.8 (50% bis CHF 400)"},
  { id:'sehhilfen', name:'Sehhilfen', icon:'👓', coverage:1.0, budgetCHF:300, period:'3y', reference:'Beilagen S.8 (100% bis CHF 300 / 3J)'},
  { id:'vorsorge', name:'Vorsorge / Check-ups', icon:'🩺', coverage:0.8, budgetCHF:1000, period:'yearly', reference:"Beilagen S.8 (80% bis CHF 1'000)"},
  { id:'haushalthilfe', name:'Haushalthilfe nach Spital', icon:'🧹', coverage:1.0, budgetCHF:750, period:'yearly', reference:'Beilagen S.9 (CHF 25/h, max. 750)'}
];
const INFO_CARDS = [
  { id:'medical_private', title:'Medical Private', detail:"Weltweit ambulant bis CHF 100'000/Jahr, 10% bis max. CHF 1'000", reference:'Beilagen S.8' },
  { id:'hospital_extra', title:'Hospital Extra Liberty', detail:'Halbprivat, Ausland-Notfall inkl. Transport/Rettung bis CHF 30’000/Jahr', reference:'Beilagen S.9–10' }
];
const LS_KEYS = { categories:'sbt_categories', entries:'sbt_entries' };
const chf = (x)=> new Intl.NumberFormat('de-CH',{style:'currency',currency:'CHF'}).format(Math.round((x+Number.EPSILON)*100)/100);

function getPeriodKey(period, date){
  const d = new Date(date);
  if(period==='yearly') return ''+d.getFullYear();
  if(period==='3y'){ const base = Math.floor(d.getFullYear()/3)*3; return `${base}-${base+2}`;}
  return 'all';
}

export default function App(){
  const [categories, setCategories] = useState(()=> JSON.parse(localStorage.getItem(LS_KEYS.categories)||'null') || DEFAULT_CATEGORIES);
  const [entries, setEntries] = useState(()=> JSON.parse(localStorage.getItem(LS_KEYS.entries)||'null') || []);
  const [tab, setTab] = useState('overview');
  const [pending, setPending] = useState({ date:new Date().toISOString().slice(0,10), categoryId:DEFAULT_CATEGORIES[0].id, description:'', amountCHF:'' });
  const fileInputRef = useRef(null);
  const [scanBusy, setScanBusy] = useState(false);

  useEffect(()=> localStorage.setItem(LS_KEYS.categories, JSON.stringify(categories)), [categories]);
  useEffect(()=> localStorage.setItem(LS_KEYS.entries, JSON.stringify(entries)), [entries]);

  const computed = useMemo(()=>{
    const now = new Date();
    const res = {};
    categories.forEach(c=> res[c.id] = { category:c, total:0, key:getPeriodKey(c.period, now) });
    entries.forEach(e=>{
      const c = categories.find(x=> x.id===e.categoryId); if(!c) return;
      const k = getPeriodKey(c.period, e.date), kk = getPeriodKey(c.period, now);
      if(k!==kk) return;
      res[c.id].total += e.reimbursedCHF||0;
    });
    Object.values(res).forEach(r=>{ r.remaining=Math.max(0, r.category.budgetCHF - r.total); r.progress=Math.min(100, (r.category.budgetCHF? (r.total/r.category.budgetCHF)*100:0)); });
    return res;
  },[categories, entries]);

  function addEntry(){
    const cat = categories.find(c=> c.id===pending.categoryId); if(!cat) return;
    const amount = Number(pending.amountCHF||0);
    const reimb = amount * cat.coverage;
    const already = computed[cat.id]?.total || 0;
    const remaining = Math.max(0, cat.budgetCHF - already);
    const reimbursedCHF = Math.max(0, Math.min(reimb, remaining));
    const newE = { id: uuidv4(), date:new Date(pending.date).toISOString(), categoryId:cat.id, description:pending.description, amountCHF:amount, reimbursedCHF };
    setEntries(prev=> [newE, ...prev]);
    setTab('overview');
  }

  async function handleScan(file){
    if(!file) return;
    setScanBusy(true);
    try{
      const { data } = await Tesseract.recognize(file, 'deu+eng', { logger:()=>{} });
      const text = data.text || '';
      // simple amount parser
      const regex = /(CHF\\s*)?([0-9]{1,3}(?:['’`][0-9]{3})*|[0-9]+)([.,][0-9]{2})?/gi;
      let m, amounts=[];
      while((m = regex.exec(text)) !== null){
        const intPart = (m[2]||'').replace(/['’`]/g,'');
        const decPart = m[3] ? m[3].replace(',', '.') : '.00';
        const val = parseFloat(`${intPart}${decPart}`);
        if(!isNaN(val)) amounts.push(val);
      }
      const amount = amounts.length ? Math.max(...amounts) : 0;
      const lower = text.toLowerCase();
      let guess = 'alternativmedizin';
      if(/fitness|yoga|abo|studio|mitglied|kurs|ernährung|mental/.test(lower)) guess='gesundheitsfoerderung';
      if(/optik|brille|kontaktlin|seh/.test(lower)) guess='sehhilfen';
      if(/check-up|checkup|prävention|vorsorge|screening/.test(lower)) guess='vorsorge';
      if(/haushalt|pflege|spital/.test(lower)) guess='haushalthilfe';
      setPending({ date:new Date().toISOString().slice(0,10), categoryId:guess, description:'Scan: Rechnung', amountCHF: amount });
      setTab('add');
    }catch(e){ alert('Scan fehlgeschlagen – bitte manuell erfassen.'); }
    finally{ setScanBusy(false); }
  }

  function exportCSV(){
    const rows = [['id','date','category','description','amountCHF','reimbursedCHF'],
      ...entries.map(e=>[e.id, new Date(e.date).toISOString().slice(0,10), categories.find(c=>c.id===e.categoryId)?.name||e.categoryId, e.description, e.amountCHF, e.reimbursedCHF])
    ];
    const csv = rows.map(r=> r.map(x=> '\"'+String(x).replace(/\"/g,'\"\"')+'\"').join(',')).join('\\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`sanitas-tracker_${THIS_YEAR}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-[100dvh] bg-[#0a1020] text-white flex flex-col">
      <header className="px-4 pt-6 pb-4 sticky top-0 z-20 bg-gradient-to-b from-[#0a1020] to-transparent">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Sanitas Benefits Tracker</h1>
            <p className="text-sm text-white/60">Deine Police smart nutzen</p>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm" onClick={exportCSV}>CSV</button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 pb-28">
        {tab==='overview' && (
          <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              {categories.map(c=>{
                const stat = computed[c.id];
                return (
                  <div key={c.id} className="rounded-2xl p-4 bg-white/5 border border-white/10">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="text-2xl">{c.icon}</div>
                        <div>
                          <div className="font-semibold">{c.name}</div>
                          <div className="text-xs text-white/60">{c.reference}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-white/60">Rest</div>
                        <div className="text-lg font-bold">{chf(stat?.remaining ?? c.budgetCHF)}</div>
                      </div>
                    </div>
                    <div className="mt-3 h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-400 to-fuchsia-500" style={{ width: `${stat?.progress ?? 0}%` }} />
                    </div>
                    <div className="mt-2 text-xs flex justify-between text-white/70">
                      <span>Erstattet: {chf(stat?.total || 0)}</span>
                      <span>Budget: {chf(c.budgetCHF)} {c.period==='3y' ? '(3 Jahre)' : '/Jahr'}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl p-4 bg-white/5 border border-white/10">
              <div className="font-semibold mb-2">Schnell hinzufügen</div>
              <button className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs" onClick={()=> setTab('add')}>+ Eintrag</button>
            </div>

            <div className="space-y-3">
              {INFO_CARDS.map(i=> (
                <div key={i.id} className="rounded-2xl p-4 bg-white/5 border border-white/10">
                  <div className="font-semibold">{i.title}</div>
                  <div className="text-sm text-white/80 mt-1">{i.detail}</div>
                  <div className="text-xs text-white/60 mt-2">Referenz: {i.reference}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {tab==='add' && (
          <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-4">
            <div className="rounded-2xl p-4 bg-white/5 border border-white/10">
              <div className="font-semibold mb-3">Eintrag hinzufügen</div>
              <div className="grid gap-3">
                <label className="text-sm">
                  <span className="block text-white/80 mb-1">Datum</span>
                  <input type="date" value={pending.date} onChange={e=> setPending(p=> ({...p, date:e.target.value}))} className="w-full px-3 py-2 rounded-xl bg-white/10 border border-white/10" />
                </label>
                <label className="text-sm">
                  <span className="block text-white/80 mb-1">Kategorie</span>
                  <select value={pending.categoryId} onChange={e=> setPending(p=> ({...p, categoryId:e.target.value}))} className="w-full px-3 py-2 rounded-xl bg-white/10 border border-white/10">
                    {categories.map(c=> <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="block text-white/80 mb-1">Beschreibung</span>
                  <input type="text" placeholder="z.B. Akupunktur Sitzung" value={pending.description} onChange={e=> setPending(p=> ({...p, description:e.target.value}))} className="w-full px-3 py-2 rounded-xl bg-white/10 border border-white/10" />
                </label>
                <label className="text-sm">
                  <span className="block text-white/80 mb-1">Rechnungsbetrag (CHF)</span>
                  <input type="number" step="0.05" placeholder="0.00" value={pending.amountCHF} onChange={e=> setPending(p=> ({...p, amountCHF:e.target.value}))} className="w-full px-3 py-2 rounded-xl bg-white/10 border border-white/10" />
                </label>
                {(()=>{
                  const cat = categories.find(c=> c.id===pending.categoryId);
                  if(!cat) return null;
                  const amount = Number(pending.amountCHF||0);
                  const reimb = amount * cat.coverage;
                  const stat = computed[cat.id];
                  const remaining = stat ? stat.remaining : cat.budgetCHF;
                  const willPay = Math.max(0, Math.min(reimb, remaining));
                  const own = Math.max(0, amount - willPay);
                  return (
                    <div className="text-sm bg-white/5 border border-white/10 rounded-xl p-3">
                      <div className="flex justify-between"><span>Coverage</span><span>{Math.round(cat.coverage*100)}%</span></div>
                      <div className="flex justify-between"><span>Vorauss. Erstattung</span><span>{chf(willPay)}</span></div>
                      <div className="flex justify-between"><span>Dein Eigenanteil</span><span>{chf(own)}</span></div>
                    </div>
                  );
                })()}
                <div className="flex gap-2">
                  <button className="flex-1 px-4 py-3 rounded-2xl bg-gradient-to-r from-blue-500 to-fuchsia-500 font-semibold" onClick={addEntry}>Speichern</button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl p-4 bg-white/5 border border-white/10">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Rechnung scannen (OCR)</div>
                {scanBusy && <div className="text-xs text-white/60 animate-pulse">Scan läuft…</div>}
              </div>
              <p className="text-sm text-white/70 mt-1">Foto aufnehmen oder aus der Galerie wählen.</p>
              <div className="mt-3 flex gap-2">
                <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e=> e.target.files && handleScan(e.target.files[0])} />
                <button className="px-4 py-3 rounded-2xl bg-white/10 border border-white/10" onClick={()=> fileInputRef.current?.click()}>Kamera / Foto wählen</button>
              </div>
            </div>
          </motion.div>
        )}

        {tab==='history' && (
          <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-3">
            {entries.length===0 && <div className="text-white/70 text-sm">Noch keine Einträge – füge deinen ersten hinzu.</div>}
            {entries.map(e=>{
              const cat = categories.find(c=> c.id===e.categoryId);
              return (
                <div key={e.id} className="rounded-2xl p-4 bg-white/5 border border-white/10">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{cat?.name || e.categoryId}</div>
                      <div className="text-xs text-white/60">{new Date(e.date).toLocaleDateString('de-CH')}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm">Betrag: {chf(e.amountCHF)}</div>
                      <div className="text-xs text-white/70">Erstattung: {chf(e.reimbursedCHF)}</div>
                    </div>
                  </div>
                  {e.description && <div className="text-sm text-white/80 mt-2">{e.description}</div>}
                </div>
              );
            })}
          </motion.div>
        )}

        {tab==='settings' && (
          <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-4">
            <div className="rounded-2xl p-4 bg-white/5 border border-white/10">
              <div className="font-semibold">Budgets & Coverage anpassen</div>
              <div className="mt-3 space-y-3">
                {categories.map(c=> (
                  <div key={c.id} className="rounded-xl p-3 bg-white/5 border border-white/10">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-xs text-white/60">{c.period==='3y' ? 'Intervall: 3 Jahre' : 'Intervall: jährlich'}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2 text-sm">
                      <label className="col-span-2">
                        <span className="block text-white/70">Budget (CHF)</span>
                        <input type="number" step="1" value={c.budgetCHF} onChange={e=>{
                          const v = Number(e.target.value||0);
                          setCategories(cats=> cats.map(cc=> cc.id===c.id ? {...cc, budgetCHF:v} : cc));
                        }} className="w-full px-3 py-2 rounded-xl bg-white/10 border border-white/10" />
                      </label>
                      <label>
                        <span className="block text-white/70">Coverage %</span>
                        <input type="number" step="1" value={Math.round(c.coverage*100)} onChange={e=>{
                          const v = Math.max(0, Math.min(100, Number(e.target.value||0)));
                          setCategories(cats=> cats.map(cc=> cc.id===c.id ? {...cc, coverage: v/100} : cc));
                        }} className="w-full px-3 py-2 rounded-xl bg-white/10 border border-white/10" />
                      </label>
                    </div>
                    <div className="text-xs text-white/60 mt-1">Referenz: {c.reference}</div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-[#0a1020]/90 backdrop-blur border-t border-white/10">
        <div className="max-w-screen-sm mx-auto flex">
          <button onClick={()=>setTab('overview')} className={`flex-1 py-2 ${tab==='overview'?'text-white':'text-white/70'}`}>🏠<div className="text-xs">Übersicht</div></button>
          <button onClick={()=>setTab('add')} className={`flex-1 py-2 ${tab==='add'?'text-white':'text-white/70'}`}>➕<div className="text-xs">Hinzufügen</div></button>
          <button onClick={()=>setTab('history')} className={`flex-1 py-2 ${tab==='history'?'text-white':'text-white/70'}`}>🧾<div className="text-xs">Historie</div></button>
          <button onClick={()=>setTab('settings')} className={`flex-1 py-2 ${tab==='settings'?'text-white':'text-white/70'}`}>⚙️<div className="text-xs">Einstellungen</div></button>
        </div>
      </nav>

      <AnimatePresence>
        {tab==='overview' && (
          <motion.button initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} exit={{opacity:0,y:20}} onClick={()=>setTab('add')} className="fixed bottom-20 right-4 px-5 py-4 rounded-2xl shadow-xl bg-gradient-to-r from-blue-500 to-fuchsia-500 font-semibold">
            + Eintrag
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
