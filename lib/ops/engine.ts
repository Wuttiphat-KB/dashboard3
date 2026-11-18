// @ts-nocheck
/* eslint-disable */
/**
 * Ops console engine — ported from the Charger Ops prototype (simulated data).
 * Singleton so scope / tickets / selections survive navigation between /ops/* pages.
 */
export type OpsEngine = ReturnType<typeof createOps>;

function createOps(navigate: (view: string) => void) {

/* ============ seeded random ============ */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
let R=mulberry32(20261027);
const rnd=()=>R(), ri=(a,b)=>a+Math.floor(R()*(b-a+1)), pick=a=>a[Math.floor(R()*a.length)];
function wpick(items){let s=0;for(const it of items)s+=it[1];let x=R()*s;for(const it of items){x-=it[1];if(x<=0)return it[0]}return items[items.length-1][0]}
function poisson(l){let L=Math.exp(-l),k=0,p=1;do{k++;p*=R()}while(p>L);return k-1}
const $=s=>document.querySelector(s);
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
const fmtPct=x=>(x*100).toFixed(1)+"%";
const HOUR=3600e3, DAY=24*HOUR;
const NOW=new Date("2026-10-27T14:20:00+07:00").getTime();
const DAY0=NOW-30*DAY;
function fmtDT(t){const d=new Date(t);return d.toLocaleDateString("en-GB",{day:"numeric",month:"short",timeZone:"Asia/Bangkok"})+" "+d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Bangkok"})}
function fmtD(t){return new Date(t).toLocaleDateString("en-GB",{day:"numeric",month:"short",timeZone:"Asia/Bangkok"})}
function fmtT(t){return new Date(t).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Bangkok"})}
function ago(t){const m=Math.round((NOW-t)/60000);if(m<60)return m+" min ago";const h=Math.round(m/60);if(h<48)return h+" h ago";return Math.round(h/24)+" days ago"}

/* ============ fleet model ============ */
const CUSTOMERS=[
 {id:"sky",name:"SKY EV",auth:"app",note:"App scan, 2-min auth window"},
 {id:"rvf",name:"Riverside Fuel",auth:"rfid"},
 {id:"mtp",name:"Metro Plaza Group",auth:"app"},
 {id:"ngm",name:"Northgate Malls",auth:"rfid"},
 {id:"csh",name:"Coastline Hotels",auth:"app"},
 {id:"cmp",name:"Campus Energy",auth:"rfid"}];
const SITES=[
 ["sky","Phutthamonthon Sai 5","Nakhon Pathom",12],["sky","Chumphon","Chumphon",4],["sky","Ratchaphruek","Bangkok",4],["sky","Phraeksa","Samut Prakan",4],["sky","Rattanathibet","Nonthaburi",6],["sky","Srinakarin","Bangkok",6],
 ["rvf","Rama 2 km 34","Samut Sakhon",10],["rvf","Bang Pa-in","Ayutthaya",8],["rvf","Mittraphap Korat","Nakhon Ratchasima",10],["rvf","Hua Hin South","Prachuap",8],
 ["mtp","Metro Plaza Bang Na","Bangkok",16],["mtp","Metro Plaza Rangsit","Pathum Thani",14],["mtp","Metro Plaza Chiang Mai","Chiang Mai",10],
 ["ngm","Northgate Khon Kaen","Khon Kaen",10],["ngm","Northgate Udon","Udon Thani",10],["ngm","Northgate Hat Yai","Songkhla",8],
 ["csh","Coastline Pattaya","Chonburi",8],["csh","Coastline Phuket","Phuket",12],["csh","Coastline Krabi","Krabi",6],["csh","Coastline Rayong","Rayong",6],
 ["cmp","North Campus","Pathum Thani",8],["cmp","Science Park","Pathum Thani",10],["cmp","Hospital Annex","Bangkok",6],["cmp","Tech Hub","Chonburi",4]];
const MODELS=[ // name, share, battery class, max kW, mgFamily
 {n:"BYD Atto 3",w:16,kw:88},{n:"BYD Dolphin",w:12,kw:60},{n:"BYD Seal",w:7,kw:150},{n:"MG4",w:9,kw:135,mg:1},{n:"MG ZS EV",w:6,kw:76,mg:1},{n:"MG EP",w:3,kw:50,mg:1},
 {n:"Deepal S05",w:6,kw:110,lowStart:1},{n:"ORA Good Cat",w:6,kw:64},{n:"Neta V",w:5,kw:40},{n:"Aion Y Plus",w:5,kw:80,aion:1},{n:"Tesla Model Y",w:8,kw:170},{n:"Volvo EX30",w:4,kw:134},
 {n:"Jaecoo J6",w:3,kw:60,jaecoo:1},{n:"BYD Sealion 6 DM-i",w:3,kw:18},{n:"Zeekr X",w:3,kw:150}];
const CAP={"BYD Atto 3":60,"BYD Dolphin":45,"BYD Seal":82,"MG4":64,"MG ZS EV":50,"MG EP":51,"Deepal S05":56,"ORA Good Cat":48,"Neta V":38,"Aion Y Plus":63,"Tesla Model Y":75,"Volvo EX30":64,"Jaecoo J6":65,"BYD Sealion 6 DM-i":18,"Zeekr X":66};
const HW={DC120:{kw:120,mods:3,name:"DC120 · 3×40 kW, 2 heads"},DC160:{kw:160,mods:4,name:"DC160 · 4×40 kW, 2 heads"},DC60:{kw:60,mods:2,name:"DC60 · 2×30 kW, 2 heads"}};
const STAGES=["plug","slac","auth","contract","pre","energy","stop"];
const STAGE_NAME={plug:"Plugged in",slac:"SLAC",auth:"Authorisation",contract:"ContractAuth",pre:"PreCharge",energy:"Delivering power",stop:"Normal stop"};
const FAIL_STAGE={slac:"SLAC",auth:"Authorisation",contract:"ContractAuth",pre:"PreCharge",drop:"Drop mid-charge"};
const CAUSE={
 hang:{t:"Controller / PLC hang",o:"EDS"},ps:{t:"Power-sharing voltage swing",o:"EDS"},dclink:{t:"DC link stuck",o:"EDS"},meter:{t:"Meter read error",o:"EDS"},
 veh:{t:"Vehicle communication",o:"Vehicle"},vehfw:{t:"Vehicle firmware",o:"Vehicle"},timeout:{t:"Plug-and-scan timeout",o:"Shared"},cpo:{t:"CPO remote stop",o:"CPO"},
 unknown:{t:"Unclassified",o:"Unassigned"},sitenet:{t:"Site network dropping app starts",o:"Site"},offline:{t:"Site offline",o:"Site"},hw:{t:"Hardware fault",o:"EDS"}};

const sites=SITES.map((s,i)=>({id:"S"+String(i+1).padStart(2,"0"),cust:s[0],name:s[1],prov:s[2],n:s[3],busy:0.6+rnd()*0.9}));
const chargers=[];
sites.forEach(s=>{for(let k=0;k<s.n;k++){
  const hwK=s.cust==="sky"?"DC120":wpick([["DC120",6],["DC160",3],["DC60",2]]);
  const fw=wpick([["2.4.1",86],["2.3.7",6],["2.5.0-rc2",8]]);
  const c={id:s.id+"-C"+String(k+1).padStart(2,"0"),site:s.id,cust:s.cust,num:k+1,hw:hwK,fw,psBug:hwK!=="DC60"&&fw!=="2.5.0-rc2",
    meterBug:fw==="2.4.1"&&rnd()<0.06,installed:NOW-ri(120,900)*DAY,temps:[],heads:[]};
  for(let m=0;m<HW[hwK].mods;m++)c.temps.push(52+Math.round(rnd()*10));
  for(let h=1;h<=2;h++)c.heads.push({id:c.id+"-H"+h,ch:c,n:h,status:"Available",hangs:[],sessions:[]});
  chargers.push(c);}});
const heads=chargers.flatMap(c=>c.heads);
const byId={};chargers.forEach(c=>byId[c.id]=c);heads.forEach(h=>byId[h.id]=h);
const siteById={};sites.forEach(s=>siteById[s.id]=s);
const custById={};CUSTOMERS.forEach(c=>custById[c.id]=c);
const label=c=>`${siteById[c.site].name} · C${c.num}`;
const hlabel=h=>`${label(h.ch)} H${h.n}`;

// fault injections modelled on real incidents
const sai5=sites[0];
const sai5ch=chargers.filter(c=>c.site===sai5.id);
const hangHeads=[byId[sai5ch[4].id+"-H1"],byId[sai5ch[2].id+"-H1"],byId[sai5ch[1].id+"-H1"]];
for(let i=0;i<6;i++)hangHeads.push(pick(heads));
hangHeads.forEach((h,i)=>{const k=i<3?ri(3,5):ri(1,2);for(let e=0;e<k;e++){const st=DAY0+ri(1,29)*DAY+ri(7,15)*HOUR+ri(0,59)*60e3;h.hangs.push({start:st,end:st+(2+rnd()*8)*HOUR})}});
// one hang ongoing now on Sai 5 C5 H1
hangHeads[0].hangs.push({start:NOW-74*60e3,end:NOW+10*HOUR,ongoing:true});
const chum=chargers.filter(c=>c.site===sites[1].id);
const dclinkPair=[chum[0],chum[1]];dclinkPair.forEach(c=>c.dclink={from:NOW-11*DAY,to:NOW-9*DAY});
chum[2].configDrift=true;chum[3].configDrift=true;
const offlineSite=sites[2]; offlineSite.offlineNow=true; offlineSite.offlineSince=NOW-23*60e3;
const backendOutage={start:NOW-18*DAY+9*HOUR,end:NOW-18*DAY+10*HOUR};
chargers.forEach(c=>{c.down=[]; if(rnd()<0.015){c.temps[c.temps.length-1]=70+ri(2,8);c.hotModule=true} });
for(let i=0;i<9;i++){const c=pick(chargers);const st=DAY0+ri(1,27)*DAY+ri(0,23)*HOUR;c.down.push({start:st,end:st+ri(4,46)*HOUR,why:pick(["Cable damage","Contactor fault","Cooling fan failure","Insulation monitor fault"])})}
for(let i=0;i<4;i++){const s=pick(sites);const st=DAY0+ri(1,28)*DAY+ri(6,20)*HOUR;const dur=ri(1,6)*HOUR;chargers.filter(c=>c.site===s.id).forEach(c=>c.down.push({start:st,end:st+dur,why:"Site offline"}))}
const brokenNow=pick(chargers.filter(c=>c.site!==offlineSite.id&&c.site!==sai5.id));brokenNow.down.push({start:NOW-19*HOUR,end:NOW+30*HOUR,why:"Cable damage, head 2",head:2,ongoing:true});

/* ============ sessions ============ */
let sid=1;
const evSite=sites.find(s=>s.name==="Metro Plaza Rangsit");const todayStart=Math.floor((NOW+7*HOUR)/DAY)*DAY-7*HOUR;const evStart=todayStart+8*HOUR+10*60e3;const evR=mulberry32(4242);
const sessions=[];
function inHang(h,t){return h.hangs.find(x=>t>=x.start&&t<=x.end)}
heads.forEach(h=>{
  const s=siteById[h.ch.site], cust=custById[s.cust];
  for(let d=0;d<30;d++){
    const lam=(4+5*s.busy)*(h.n===1?1.05:0.95);
    const n=poisson(lam);
    for(let k=0;k<n;k++){
      const t=DAY0+d*DAY+(6+rnd()*17)*HOUR;
      if(t>NOW)continue;
      const m=wpick(MODELS.map((x,i)=>[i,x.w])); const mo=MODELS[m];
      let out="ok",cause=null,dip=false,lowKw=false,meter=false;
      if(h.ch.down.some(x=>t>=x.start&&t<=x.end&&(!x.head||x.head===h.n)))continue;
      const hg=inHang(h,t);
      if(hg){out="slac";cause="hang"}
      else if(t>=backendOutage.start&&t<=backendOutage.end){out="auth";cause="cpo"}
      else if(mo.jaecoo&&rnd()<0.45){out="contract";cause="vehfw"}
      else if(cust.auth==="app"&&rnd()<0.028){out="auth";cause="timeout"}
      else if(rnd()<0.007){out="slac";cause="veh"}
      else if(rnd()<0.005){out="contract";cause="veh"}
      else if(rnd()<0.004){out="pre";cause=rnd()<0.5?"veh":"unknown"}
      else if(mo.mg&&h.ch.psBug&&rnd()<0.16){out="drop";cause="ps";dip=true}
      else if(mo.aion&&rnd()<0.06){out="drop";cause="unknown"}
      else if(rnd()<0.003){out="drop";cause="cpo"}
      else if(rnd()<0.004){out="drop";cause="unknown"}
      if(out==="ok"&&h.ch.dclink&&t>=h.ch.dclink.from&&t<=h.ch.dclink.to){lowKw=true;cause="dclink"}
      if(out==="ok"&&h.ch.meterBug&&rnd()<0.004){meter=true;cause="meter"}
      let maxKw=Math.min(mo.kw,HW[h.ch.hw].kw*(rnd()<0.35?0.5:1)*(lowKw?0.62:1));if(dip)maxKw=Math.min(mo.kw,HW[h.ch.hw].kw);
      let dur=out==="ok"?ri(18,62):out==="drop"?ri(3,25):1;
      let kwh=out==="ok"||out==="drop"?+(maxKw*dur/60*(0.55+rnd()*0.3)).toFixed(1):0;
      const soc0=ri(8,45);const room=(CAP[mo.n]||60)*(0.96-soc0/100);
      if(kwh>room){kwh=+room.toFixed(1);dur=Math.max(5,Math.ceil(kwh/(maxKw*0.7)*60))}
      if(evSite&&h.ch.site===evSite.id&&t>=evStart&&evR()<0.52){out="auth";cause="sitenet";dip=false;lowKw=false;meter=false;dur=1;kwh=0}
      const S={id:"CHG"+String(sid++).padStart(6,"0"),h,t,m,out,cause,dip,lowKw,meter,maxKw:Math.round(maxKw),dur,kwh:meter?0:kwh,soc0};
      sessions.push(S);h.sessions.push(S);
    }
  }
  h.sessions.sort((a,b)=>a.t-b.t);
});
{const h=hangHeads[0];const ep=h.hangs.find(x=>x.ongoing);[[-66,3],[-41,9],[-17,0]].forEach(([mn,m])=>{const S={id:"CHG"+String(sid++).padStart(6,"0"),h,t:NOW+mn*60e3,m,out:"slac",cause:"hang",dip:false,lowKw:false,meter:false,maxKw:0,dur:1,kwh:0,soc0:ri(10,40)};sessions.push(S);h.sessions.push(S)});h.sessions.sort((a,b)=>a.t-b.t)}
sessions.sort((a,b)=>a.t-b.t);
// live status
heads.forEach(h=>{
  const s=siteById[h.ch.site];
  if(s.offlineNow)h.status="Offline";
  else if(h.hangs.some(x=>x.ongoing)||h.ch.down.some(x=>x.ongoing&&(!x.head||x.head===h.n)))h.status="Faulted";
  else h.status=wpick([["Charging",33],["Available",62],["Preparing",5]]);
});
/* ============ derived: alerts & tickets ============ */
const alerts=[];let aid=1;
function addAlert(o){o.id="AL-"+String(aid++).padStart(4,"0");o.ack=o.t<NOW-2*DAY;alerts.push(o);return o}
heads.forEach(h=>{
  let run=[];
  h.sessions.forEach(s=>{
    if(s.out==="ok"){run=[];return}
    if(s.out==="drop"||s.out==="auth"){run=[];return}
    if(run.length&&run[run.length-1].out===s.out&&run[run.length-1].m!==s.m&&s.t-run[run.length-1].t<4*HOUR){run.push(s);
      if(run.length===2){const fx=s.cause==="hang";const ongo=h.hangs.find(x=>x.ongoing&&s.t>=x.start);
        addAlert({rule:"r1",sev:"Critical",t:s.t+60e3,target:h.id,first:run[0].t,
          title:`${hlabel(h)} failed 2 sessions in a row at ${FAIL_STAGE[s.out]}`,
          detail:`Different car models (${MODELS[run[0].m].n}, ${MODELS[s.m].n}); sibling head ${h.n===1?2:1} is charging normally.`,
          action:"Comm stack reset when idle",result:ongo?"Reset queued, waiting for the head to be idle":fx?"Recovered after reset":"No change, ticket opened",fixedAt:fx&&!ongo?s.t+5*60e3:null,cause:s.cause,session:s.id})}}
    else run=[s];
  });
});
dclinkPair.forEach(c=>{const s=c.heads.flatMap(h=>h.sessions).filter(x=>x.lowKw).sort((a,b)=>a.t-b.t)[0];
  if(s)addAlert({rule:"r2",sev:"High",t:s.t+3*60e3,target:c.id,title:`${label(c)} delivering ${s.maxKw} kW, well below the requested power`,detail:"Current stayed under 70% of the allowed limit for 60 s while the car asked for more. DC-link contactor to the paired charger did not close.",action:"Flag DC link + open ticket",result:"Ticket opened",session:s.id,cause:"dclink"})});
sessions.filter(s=>s.meter).forEach(s=>addAlert({rule:"r3",sev:"High",t:s.t+s.dur*60e3,target:s.h.id,title:`${hlabel(s.h)} billed 0 kWh although current flowed`,detail:`meterStart equals meterStop. Energy rebuilt from integrated power.`,action:"Use integrated energy + flag billing",result:"Billing corrected",session:s.id,cause:"meter"}));
addAlert({rule:"r4",sev:"High",t:backendOutage.end,target:"fleet",title:"CPO backend reconnected after a 60-minute outage",detail:"Sessions left in Preparing on 14 chargers were reset so the next driver can start.",action:"Reset stuck session state",result:"14 chargers recovered",cause:"cpo"});
addAlert({rule:"r5",sev:"High",t:offlineSite.offlineSince+5*60e3,target:offlineSite.id,title:`${offlineSite.name}: no heartbeat from ${offlineSite.n} chargers`,detail:"All chargers at the site went silent together, which points to site power or internet rather than the chargers.",action:"Notify site to check mains and router",result:"Waiting for site",cause:"offline"});
{const ss=sessions.filter(s=>s.h.ch.site===evSite.id&&s.t>=evStart);const f=ss.filter(s=>s.cause==="sitenet").length;
 addAlert({rule:"r7",sev:"High",t:evStart+95*60e3,target:evSite.id,title:`${evSite.name}: success rate ${Math.round(100*(1-ss.filter(s=>s.out!=="ok").length/Math.max(1,ss.length)))}% since 08:10, far below the fleet`,detail:`${f} app starts never reached the chargers (RemoteStartTransaction lost). Every charger at the site is affected, so the site network is the likely cause, not the chargers.`,action:"Notify site IT + switch site to RFID fallback",result:"Waiting for site",cause:"sitenet"})}
chargers.filter(c=>c.hotModule).forEach(c=>addAlert({rule:"r6",sev:"Medium",t:NOW-ri(1,72)*HOUR,target:c.id,title:`${label(c)} power module ${c.temps.length} at ${c.temps[c.temps.length-1]} °C`,detail:"Hotter than its peers by more than 12 °C for 10 minutes. Check fan and air filter.",action:"Derate module + schedule maintenance",result:"Maintenance scheduled",cause:"hw"}));
alerts.sort((a,b)=>b.t-a.t);
const RULES=[
 {id:"r1",name:"Same-step failures on one head",cond:"A head fails 2 sessions in a row at the same step within 4 h, while other heads at the site are fine.",act:"Reset the communication stack when the head is idle; open a ticket if it fails again.",from:"22 Aug: Sai 5 C3 H1 failed for 5 cars over 10 hours until a manual reset.",on:true},
 {id:"r2",name:"DC link not delivering",cond:"Delivered current below 70% of the allowed limit for 60 s while the car requests more.",act:"Flag the DC link and open a ticket.",from:"16 Oct: Chumphon C1 delivered 166 A of 250 A requested.",on:true},
 {id:"r3",name:"Zero-energy billing",cond:"meterStart equals meterStop although current flowed.",act:"Bill from integrated energy and flag for review.",from:"4 Oct: a session was billed 0 kWh.",on:true},
 {id:"r4",name:"Backend reconnect",cond:"The CPO backend comes back after a lost connection.",act:"Reset sessions stuck in Preparing on every affected charger.",from:"26 Aug: PLCs stayed stuck after a CPO outage.",on:true},
 {id:"r5",name:"Site silent",cond:"No heartbeat from every charger at a site for 5 minutes.",act:"Notify the site to check mains and internet.",from:"25 Sep and 6 Oct: two sites went offline.",on:true},
 {id:"r7",name:"Site success rate drop",cond:"A site’s success rate over the last 2 hours is more than 25 points below the fleet.",act:"Notify site IT and switch the site to RFID fallback.",from:"Pattern seen when site routers drop CPO traffic.",on:true},
 {id:"r6",name:"Module running hot",cond:"A power module runs 12 °C hotter than its peers for 10 minutes.",act:"Derate the module and schedule maintenance.",from:"Preventive rule, no incident yet.",on:true}];
const tickets=[];let tid=1;
function addTicket(o){o.id="T-"+String(tid++).padStart(4,"0");o.sla=o.created+24*HOUR;tickets.push(o);return o}
const meterSeen=new Set();
alerts.filter(a=>["r1","r2","r3","r5","r6","r7"].includes(a.rule)).forEach(a=>{
  if(a.rule==="r1"&&a.result.startsWith("Recovered")&&a.t<NOW-3*DAY)return;
  if(a.rule==="r3"){const c=targetCharger(a.target).id;if(meterSeen.has(c))return;meterSeen.add(c)}
  const age=NOW-a.t;
  const status=a.target===offlineSite.id||a.rule==="r7"||age<12*HOUR?"New":age<30*HOUR?"Investigating":a.rule==="r3"&&age<10*DAY?"Waiting partner":"Closed";
  addTicket({created:a.t,title:a.title,alert:a.id,session:a.session||null,target:a.target,cause:a.cause,status,source:"Alert",
    rca:a.rule==="r3"?"OCPP meter read raced StopTransaction. Fix ships in 2.5.0; billing corrected from integrated energy.":status==="Closed"?(a.cause==="hang"?"Controller session state not reset after aborted SLAC. Vendor fix scheduled in 2.5.0.":a.cause==="meter"?"OCPP meter read raced StopTransaction. Fixed in 2.5.0.":"Resolved on site."):""});
});
[["Coastline Phuket","Customer says charging is slow on a Deepal S05",6,"Deepal S05"],["Metro Plaza Bang Na","Jaecoo J6 will not start on any head",30,"Jaecoo J6"],["Northgate Udon","Connector stuck after charging, staff released it",50,"BYD Dolphin"]].forEach(([sn,tx,hrs,mdl])=>{
  const s=sites.find(x=>x.name===sn);const c=chargers.find(x=>x.site===s.id);
  addTicket({created:NOW-hrs*HOUR,title:`${label(c)}: ${tx}`,target:c.id,cause:mdl==="Jaecoo J6"?"vehfw":mdl==="Deepal S05"?"veh":"unknown",status:hrs<12?"New":hrs<40?"Waiting partner":"Investigating",source:"LINE OA",model:mdl,rca:mdl==="Jaecoo J6"?"Car never sends ContractAuthenticationReq; known on some production lots. Importer asked for a firmware update.":""});
});
chargers.forEach(c=>c.down.filter(x=>x.why!=="Site offline").forEach(x=>{const st=x.ongoing?"Investigating":"Closed";addTicket({created:x.start,title:`${label(c)}: ${x.why}`,target:c.id,cause:"hw",status:st,source:"Alert",rca:x.ongoing?"":`${x.why}. Part replaced on site.`})}));
tickets.sort((a,b)=>b.created-a.created);

/* ============ scope ============ */
const scope={cust:"all",site:"all"};
const sel={charger:hangHeads[0].ch.id,session:null};
function inScopeCharger(c){return(scope.cust==="all"||c.cust===scope.cust)&&(scope.site==="all"||c.site===scope.site)}
function scopeChargers(){return chargers.filter(inScopeCharger)}
function scopeSessions(){return sessions.filter(s=>inScopeCharger(s.h.ch))}
function targetCharger(t){if(!t)return null;if(byId[t])return byId[t].ch||byId[t];return null}
function inScopeTarget(t){if(t==="fleet")return scope.site==="all";if(siteById[t])return(scope.cust==="all"||siteById[t].cust===scope.cust)&&(scope.site==="all"||scope.site===t);const c=targetCharger(t);return c?inScopeCharger(c):true}
function scopeName(){if(scope.site!=="all")return siteById[scope.site].name;if(scope.cust!=="all")return custById[scope.cust].name;return"All customers"}

/* ============ stats ============ */
function stats(list){const n=list.length;const ok=list.filter(s=>s.out==="ok").length;const by={};list.forEach(s=>{if(s.out!=="ok")by[s.out]=(by[s.out]||0)+1});
  const kwh=list.reduce((a,s)=>a+s.kwh,0);return{n,ok,fail:n-ok,rate:n?ok/n:0,by,kwh}}
function downHours(c,from=DAY0,to=NOW){let h=0;c.heads.forEach(hd=>hd.hangs.forEach(x=>{const a=Math.max(x.start,from),b=Math.min(x.end,to);if(b>a)h+=(b-a)/HOUR}));c.down.forEach(x=>{const a=Math.max(x.start,from),b=Math.min(x.end,to);if(b>a)h+=(b-a)/HOUR*(x.head?1:2)});
  if(siteById[c.site].offlineNow)h+=2*(NOW-siteById[c.site].offlineSince)/HOUR;return h}
const fmtAv=x=>(x*100).toFixed(2)+"%";
function availability(cs){if(!cs.length)return 1;const tot=cs.length*2*30*24;const d=cs.reduce((a,c)=>a+downHours(c),0);return 1-d/tot}
function median(a){if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function topCause(list){const c={};list.forEach(s=>{if(s.out!=="ok"&&s.cause)c[s.cause]=(c[s.cause]||0)+1});const k=Object.keys(c).sort((a,b)=>c[b]-c[a])[0];return k?CAUSE[k].t:"–"}
function ownerCounts(list){const o={};list.forEach(s=>{if(s.out!=="ok"||s.lowKw||s.meter){const k=CAUSE[s.cause||"unknown"].o;o[k]=(o[k]||0)+1}});return o}

const failTxt=o=>o==="drop"?"Stopped mid-charge":"Failed at "+FAIL_STAGE[o];
/* ============ charts ============ */
function lineChart(labels,series,{h=200,min=null,max=null,fmt=v=>v,target=null,targetLabel=""}={}){
  const W=640,H=h,l=44,r=10,t=12,b=26;const all=series.flatMap(s=>s.values).filter(v=>v!=null);
  let lo=min??Math.min(...all),hi=max??Math.max(...all);if(target!=null){lo=Math.min(lo,target);hi=Math.max(hi,target)}if(hi===lo)hi=lo+1;
  const x=i=>l+(W-l-r)*i/Math.max(1,labels.length-1),y=v=>t+(H-t-b)*(1-(v-lo)/(hi-lo));
  let g="";for(let k=0;k<=4;k++){const v=lo+(hi-lo)*k/4;g+=`<line x1="${l}" x2="${W-r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${l-6}" y="${y(v)+4}" font-size="11" text-anchor="end" fill="var(--muted)">${esc(fmt(v))}</text>`}
  labels.forEach((lb,i)=>{if(i%Math.ceil(labels.length/8)===0)g+=`<text x="${x(i)}" y="${H-6}" font-size="11" text-anchor="middle" fill="var(--muted)">${esc(lb)}</text>`});
  if(target!=null)g+=`<line x1="${l}" x2="${W-r}" y1="${y(target)}" y2="${y(target)}" stroke="var(--ok)" stroke-dasharray="5 5"/><text x="${W-r}" y="${y(target)-5}" font-size="11" text-anchor="end" fill="var(--ok)">${esc(targetLabel)}</text>`;
  series.forEach(s=>{const p=s.values.map((v,i)=>v==null?null:`${x(i)},${y(v)}`).filter(Boolean).join(" ");g+=`<polyline points="${p}" fill="none" stroke="${s.color}" stroke-width="2.4"/>`;
    s.values.forEach((v,i)=>{if(v!=null)g+=`<circle cx="${x(i)}" cy="${y(v)}" r="7" fill="transparent"><title>${esc(labels[i]+": "+fmt(v))}</title></circle>`})});
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(series.map(s=>s.name).join(", "))} chart">${g}</svg>`}
function hbars(rows,{fmt=v=>v,max=null,lw=170}={}){const mx=max??Math.max(1,...rows.map(r=>r.v));
  return `<div style="display:flex;flex-direction:column;gap:7px">${rows.map(r=>`<div style="display:grid;grid-template-columns:${lw}px 1fr auto;gap:10px;align-items:center;font-size:13px"><span title="${esc(r.l)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.l)}</span><span style="background:var(--panel2);border-radius:4px;height:16px;display:block"><span style="display:block;height:16px;border-radius:4px;width:${(100*r.v/mx).toFixed(1)}%;background:${r.c||"var(--info)"}"></span></span><span style="font-variant-numeric:tabular-nums;min-width:56px;text-align:right">${esc(fmt(r.v))}${r.s?` <span class="muted">${esc(r.s)}</span>`:""}</span></div>`).join("")}</div>`}
function dailyStack(list,days=30){const ok=Array(days).fill(0),fl=Array(days).fill(0);list.forEach(s=>{const d=Math.floor((s.t-(NOW-days*DAY))/DAY);if(d>=0&&d<days){s.out==="ok"?ok[d]++:fl[d]++}});
  const W=640,H=170,l=34,b=24,t=8;const mx=Math.max(1,...ok.map((v,i)=>v+fl[i]));const bw=(W-l-6)/days;let g="";
  for(let k=0;k<=3;k++){const v=Math.round(mx*k/3);const y=t+(H-t-b)*(1-v/mx);g+=`<line x1="${l}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${l-5}" y="${y+4}" font-size="11" fill="var(--muted)" text-anchor="end">${v}</text>`}
  for(let i=0;i<days;i++){const x=l+i*bw+1;const ho=(H-t-b)*ok[i]/mx,hf=(H-t-b)*fl[i]/mx;const d=NOW-(days-i-1)*DAY;
    g+=`<g><title>${fmtD(d)}: ${ok[i]} ok, ${fl[i]} failed</title><rect x="${x}" y="${H-b-ho}" width="${bw-2}" height="${ho}" fill="var(--ok)" opacity=".75"/><rect x="${x}" y="${H-b-ho-hf}" width="${bw-2}" height="${hf}" fill="var(--bad)"/></g>`;
    if(i%5===0)g+=`<text x="${x+bw/2}" y="${H-6}" font-size="11" text-anchor="middle" fill="var(--muted)">${esc(fmtD(d))}</text>`}
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Sessions per day, completed and failed">${g}</svg>`}
const OWNER_COLOR={EDS:"var(--accent)",Vehicle:"var(--info)",Shared:"var(--warn)",CPO:"#8C6BD1",Unassigned:"var(--bad)",Site:"var(--off)"};
function sevTag(s){return `<span class="tag ${s==="Critical"?"t-bad":s==="High"?"t-warn":"t-info"}">${esc(s)}</span>`}
function statusTag(st){return `<span class="tag ${st==="Faulted"?"t-bad":st==="Offline"?"t-off":st==="Charging"?"t-info":st==="Preparing"?"t-warn":"t-ok"}">${esc(st)}</span>`}
/* ============ views ============ */
let V=null;
function go(view,opts={}){Object.assign(sel,opts);if(current===view)render();else navigate(view)}
function vh(t,sub,right=""){return `<div class="vh"><div><h2>${esc(t)}</h2>${sub?`<p>${sub}</p>`:""}</div>${right}</div>`}

function q(sorted,p){const i=(sorted.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo)}
const bkkDay=t=>Math.floor((t+7*HOUR)/DAY);
function successBoxData(ss){
  const multiSite=new Set(ss.map(s=>s.h.ch.site)).size>1;const key=multiSite?s=>s.h.ch.site:s=>s.h.ch.id;const nameOf=k=>multiSite?siteById[k].name:label(byId[k]);const minN=multiSite?5:3;
  const t0=bkkDay(NOW)-29;const days=[];
  for(let i=0;i<30;i++){const d=t0+i;const x=ss.filter(s=>bkkDay(s.t)===d);const g={};x.forEach(s=>{const k=key(s);(g[k]=g[k]||{n:0,ok:0});g[k].n++;if(s.out==="ok")g[k].ok++});
    const units=Object.entries(g).filter(([,v])=>v.n>=minN).map(([k,v])=>({k,name:nameOf(k),n:v.n,ok:v.ok,r:100*v.ok/v.n}));const v=units.map(u=>u.r).sort((a,b)=>a-b);
    if(!v.length){days.push({d,start:d*DAY-7*HOUR,empty:true});continue}
    const Q1=q(v,.25),Q3=q(v,.75),md=q(v,.5),iqr=Q3-Q1,lf=Q1-1.5*iqr,hf=Q3+1.5*iqr;
    const inl=v.filter(x=>x>=lf&&x<=hf);const ok=x.filter(s=>s.out==="ok").length;
    days.push({d,start:d*DAY-7*HOUR,Q1,Q3,md,lo:Math.min(...inl),hi:Math.max(...inl),mean:100*ok/x.length,n:x.length,ok,units,out:units.filter(u=>u.r<lf||u.r>hf),lf})}
  return{days,multiSite}}
function successBox({days,multiSite}){
  const W=1000,H=320,l=44,r=14,t=26,b=30;const vals=days.flatMap(d=>d.empty?[]:[d.lo,...d.out.map(o=>o.r)]);const lo=Math.max(0,Math.floor((Math.min(80,...vals)-5)/10)*10);const hi=100;
  const bw=(W-l-r)/days.length;const x=i=>l+i*bw+bw/2;const y=v=>t+(H-t-b)*(1-(v-lo)/(hi-lo));let g="";
  g+=`<rect x="${l+(days.length-1)*bw}" y="${t-18}" width="${bw}" height="${H-t-b+18}" fill="var(--accent-soft)" opacity=".7"/><text x="${x(days.length-1)}" y="${t-6}" font-size="11" text-anchor="middle" fill="var(--accent)" font-weight="600">today</text>`;
  for(let v=lo;v<=hi;v+=10)g+=`<line x1="${l}" x2="${W-r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${l-6}" y="${y(v)+4}" font-size="11" text-anchor="end" fill="var(--muted)">${v}%</text>`;
  days.forEach((d,i)=>{if(i%5===0||i===days.length-1)g+=`<text x="${x(i)}" y="${H-10}" font-size="11" text-anchor="middle" fill="var(--muted)">${fmtD(d.start+12*HOUR)}</text>`;if(d.empty)return;
    const w=Math.min(14,bw*0.55);
    g+=`<g><title>${fmtD(d.start+12*HOUR)} · ${d.units.length} ${multiSite?"stations":"chargers"} · median ${d.md.toFixed(1)}% · middle half ${d.Q1.toFixed(1)}–${d.Q3.toFixed(1)}% · fleet mean ${d.mean.toFixed(1)}%</title>
     <line x1="${x(i)}" x2="${x(i)}" y1="${y(d.hi)}" y2="${y(d.Q3)}" stroke="var(--muted)"/><line x1="${x(i)}" x2="${x(i)}" y1="${y(d.Q1)}" y2="${y(d.lo)}" stroke="var(--muted)"/>
     <line x1="${x(i)-w/3}" x2="${x(i)+w/3}" y1="${y(d.hi)}" y2="${y(d.hi)}" stroke="var(--muted)"/><line x1="${x(i)-w/3}" x2="${x(i)+w/3}" y1="${y(d.lo)}" y2="${y(d.lo)}" stroke="var(--muted)"/>
     <rect x="${x(i)-w/2}" y="${y(d.Q3)}" width="${w}" height="${Math.max(1,y(d.Q1)-y(d.Q3))}" fill="var(--info-soft)" stroke="var(--info)" rx="2"/>
     <line x1="${x(i)-w/2}" x2="${x(i)+w/2}" y1="${y(d.md)}" y2="${y(d.md)}" stroke="var(--info)" stroke-width="2"/></g>`;
    d.out.forEach(o=>{const bad=o.r<d.lf;g+=`<circle cx="${x(i)}" cy="${y(o.r)}" r="${i===days.length-1&&bad?6:3.5}" fill="${bad?"var(--bad)":"var(--ok)"}" ${multiSite?`data-site="${o.k}" style="cursor:pointer"`:`data-ch="${o.k}" style="cursor:pointer"`}><title>${esc(o.name)}: ${o.r.toFixed(1)}% (${o.n-o.ok} of ${o.n} failed)</title></circle>`})});
  const mp=days.map((d,i)=>d.empty?null:`${x(i)},${y(d.mean)}`).filter(Boolean).join(" ");
  g+=`<polyline points="${mp}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>`;days.forEach((d,i)=>{if(!d.empty)g+=`<circle cx="${x(i)}" cy="${y(d.mean)}" r="2.6" fill="var(--accent)"/>`});
  const td=days[days.length-1];const worst=td.empty?null:td.out.filter(o=>o.r<td.lf).sort((a,b)=>a.r-b.r)[0];
  if(worst)g+=`<text x="${x(days.length-1)-12}" y="${y(worst.r)+4}" font-size="12" text-anchor="end" fill="var(--bad)" font-weight="600">${esc(worst.name)} ${worst.r.toFixed(0)}%</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Daily distribution of success rate across ${multiSite?"stations":"chargers"}, with fleet mean">${g}</svg>`}
function boxEvent(data,ss){
  const td=data.days[data.days.length-1];if(td.empty)return `<p class="muted">No sessions yet today.</p>`;
  const worst=td.out.filter(o=>o.r<td.lf).sort((a,b)=>a.r-b.r)[0];
  const prev=data.days.slice(-8,-1).filter(d=>!d.empty);const prevMean=prev.reduce((a,d)=>a+d.mean,0)/Math.max(1,prev.length);
  if(!worst)return `<p style="margin:0">No ${data.multiSite?"station":"charger"} is an outlier today. Success rate today ${td.mean.toFixed(1)}% against ${prevMean.toFixed(1)}% over the past 7 days.</p>`;
  const wo=(td.ok-worst.ok)/(td.n-worst.n)*100;
  const fx=ss.filter(s=>bkkDay(s.t)===td.d&&(data.multiSite?s.h.ch.site:s.h.ch.id)===worst.k&&s.out!=="ok");const c={};fx.forEach(s=>{const k=s.cause||"unknown";c[k]=(c[k]||0)+1});const top=Object.keys(c).sort((a,b)=>c[b]-c[a])[0];
  return `<div class="evbox"><span class="tag t-bad">Today</span><p style="margin:6px 0 4px;font-size:15px"><b>${esc(worst.name)}</b> is at <b>${worst.r.toFixed(1)}%</b> success rate (${worst.n-worst.ok} of ${worst.n} charges failed), against a median of ${td.md.toFixed(1)}% for ${data.multiSite?"stations":"chargers"} today.</p>
   <p style="margin:0 0 6px">It pulls the ${esc(scopeName().toLowerCase()==="all customers"?"fleet":scopeName())} mean down from ${wo.toFixed(1)}% to <b>${td.mean.toFixed(1)}%</b> (−${(wo-td.mean).toFixed(1)} points). Main cause: ${esc(CAUSE[top]?.t||"unclassified")} (${c[top]} of ${fx.length}).</p>
   <div style="display:flex;gap:8px;flex-wrap:wrap">${data.multiSite?`<button class="btn" data-evsite="${worst.k}">Open ${esc(worst.name)} in Fleet monitor</button>`:`<button class="btn" data-ch="${worst.k}">Open Charger 360</button>`}<button class="btn" data-evask="${esc(worst.name)}">Ask the AI assistant</button></div></div>`}

function viewOverview(){
  const cs=scopeChargers(),ss=scopeSessions(),st=stats(ss);
  const r1=alerts.filter(a=>a.rule==="r1"&&inScopeTarget(a.target));
  const mttd=median(r1.map(a=>(a.t-a.first)/60000));
  const openT=tickets.filter(t=>t.status!=="Closed"&&inScopeTarget(t.target));
  const online=cs.flatMap(c=>c.heads).filter(h=>h.status!=="Offline"&&h.status!=="Faulted").length;
  const days=[...Array(30)].map((_,i)=>NOW-(29-i)*DAY);
  const rate=days.map(d=>{const x=ss.filter(s=>s.t>d-DAY&&s.t<=d);return x.length?x.filter(s=>s.out==="ok").length/x.length*100:null});
  const bx=successBoxData(ss);
  const own=ownerCounts(ss);const ownRows=Object.keys(own).sort((a,b)=>own[b]-own[a]).map(k=>({l:k,v:own[k],c:OWNER_COLOR[k]}));
  const totF=Object.values(own).reduce((a,b)=>a+b,0)||1;
  const sideF=x=>x.filter(s=>s.out!=="ok"&&s.cause&&["EDS","Unassigned"].includes(CAUSE[s.cause].o)).length;
  const hs=cs.flatMap(c=>c.heads).map(h=>{const x=h.sessions.filter(s=>s.t>NOW-14*DAY);const s=stats(x);return{h,s,fails:sideF(x),cause:topCause(x.filter(q=>q.cause&&["EDS","Unassigned"].includes(CAUSE[q.cause].o)))}}).filter(o=>o.fails>0).sort((a,b)=>b.fails-a.fails).slice(0,8);
  let custRows="";
  if(scope.cust==="all"){custRows=CUSTOMERS.map(cu=>{const cc=chargers.filter(c=>c.cust===cu.id);const s=stats(sessions.filter(x=>x.h.ch.cust===cu.id));const ot=tickets.filter(t=>t.status!=="Closed"&&(targetCharger(t.target)?.cust===cu.id||siteById[t.target]?.cust===cu.id)).length;
    return `<tr class="click" data-cust="${cu.id}"><td>${esc(cu.name)}</td><td class="n">${cc.length}</td><td class="n">${s.n.toLocaleString()}</td><td class="n">${fmtPct(s.rate)}</td><td class="n">${fmtAv(availability(cc))}</td><td class="n">${ot}</td></tr>`}).join("")}
  V.innerHTML=vh("Fleet overview",`${esc(scopeName())} · last 30 days · ${cs.length} chargers, ${cs.length*2} connectors`)+
  `<div class="kpis">
   <div class="kpi"><div class="l">Connectors in service now</div><div class="v">${online} / ${cs.length*2}</div><div class="s">${cs.length*2-online} faulted or offline</div></div>
   <div class="kpi"><div class="l">Availability</div><div class="v">${fmtAv(availability(cs))}</div><div class="s">target 98.0%</div></div>
   <div class="kpi"><div class="l">Success rate</div><div class="v">${fmtPct(st.rate)}</div><div class="s">${st.n.toLocaleString()} sessions</div></div>
   <div class="kpi"><div class="l">Energy delivered</div><div class="v">${Math.round(st.kwh/1000).toLocaleString()} MWh</div><div class="s">30 days</div></div>
   <div class="kpi"><div class="l">Time to detect (median)</div><div class="v">${mttd?Math.round(mttd)+" min":"–"}</div><div class="s">from first failure to alert</div></div>
   <div class="kpi"><div class="l">Open tickets</div><div class="v">${openT.length}</div><div class="s">${openT.filter(t=>t.sla<NOW&&!t.rca).length} past the 24 h root-cause deadline</div></div>
  </div>
  <div class="card" style="margin-bottom:14px"><h3>Success rate by day <small>each box is the spread across ${bx.multiSite?"stations":"chargers"}; the line is the ${scope.site==="all"?"fleet":"site"} mean</small></h3>
   <div class="grid" style="grid-template-columns:minmax(0,2.4fr) minmax(240px,1fr);align-items:start" id="boxGrid"><div>${successBox(bx)}<div class="legend"><span><i style="background:var(--info-soft);border:1px solid var(--info)"></i>Middle half of ${bx.multiSite?"stations":"chargers"}</span><span><i style="background:var(--info)"></i>Median</span><span><i style="background:var(--accent)"></i>Mean (all charges)</span><span><i style="background:var(--bad);border-radius:50%"></i>Outlier, low</span><span><i style="background:var(--ok);border-radius:50%"></i>Outlier, high</span><span>Click an outlier to drill in</span></div></div>
   <div>${boxEvent(bx,ss)}</div></div></div>
  <div class="grid g2">
   <div class="card"><h3>Why sessions failed <small>by who owns the fix</small></h3>${hbars(ownRows,{fmt:v=>v.toLocaleString(),lw:110})}<p class="muted" style="margin:10px 0 0;font-size:12.5px">EDS-side causes are ${Math.round(100*(own.EDS||0)/totF)}% of failed or flagged sessions. Unassigned failures need an engineer or the classifier.</p></div>
   <div class="card"><h3>Connectors to fix first <small>charger-side or unexplained failures, 14 days</small></h3><div class="scroll"><table class="tbl"><thead><tr><th>Connector</th><th class="n">Failures</th><th class="n">Success</th><th>Main cause</th></tr></thead><tbody>
   ${hs.map(o=>`<tr class="click" data-ch="${o.h.ch.id}"><td>${esc(hlabel(o.h))}<div class="muted" style="font-size:12px">${esc(custById[o.h.ch.cust].name)}</div></td><td class="n">${o.fails}</td><td class="n">${fmtPct(o.s.rate)}</td><td>${esc(o.cause)}</td></tr>`).join("")||`<tr><td colspan="4" class="empty">No failures in this scope.</td></tr>`}</tbody></table></div></div>
  </div>
  <div style="margin-top:14px">
   ${scope.cust==="all"?`<div class="card"><h3>By customer <small>select a row to scope the console</small></h3><div class="scroll"><table class="tbl"><thead><tr><th>Customer</th><th class="n">Chargers</th><th class="n">Sessions</th><th class="n">Success</th><th class="n">Availability</th><th class="n">Open tickets</th></tr></thead><tbody>${custRows}</tbody></table></div></div>`:
   `<div class="card"><h3>Sites <small>${esc(scopeName())}</small></h3><div class="scroll"><table class="tbl"><thead><tr><th>Site</th><th class="n">Chargers</th><th class="n">Success</th><th class="n">Availability</th></tr></thead><tbody>${sites.filter(s=>s.cust===scope.cust||scope.site===s.id).map(s=>{const cc=chargers.filter(c=>c.site===s.id);const x=stats(sessions.filter(q=>q.h.ch.site===s.id));return `<tr class="click" data-site="${s.id}"><td>${esc(s.name)}<div class="muted" style="font-size:12px">${esc(s.prov)}</div></td><td class="n">${cc.length}</td><td class="n">${fmtPct(x.rate)}</td><td class="n">${fmtAv(availability(cc))}</td></tr>`}).join("")}</tbody></table></div></div>`}
  </div>`;
  V.querySelectorAll("[data-ch]").forEach(r=>r.onclick=()=>go("charger",{charger:r.dataset.ch}));
  V.querySelectorAll("[data-cust]").forEach(r=>r.onclick=()=>{scope.cust=r.dataset.cust;scope.site="all";syncScope();render()});
  V.querySelectorAll("[data-site]").forEach(r=>r.onclick=()=>{const s=siteById[r.dataset.site];scope.cust=s.cust;scope.site=s.id;syncScope();render()});
  V.querySelectorAll("[data-evsite]").forEach(r=>r.onclick=()=>{const s=siteById[r.dataset.evsite];scope.cust=s.cust;scope.site=s.id;syncScope();fleetFilter="all";go("fleet")});
  V.querySelectorAll("[data-evask]").forEach(r=>r.onclick=()=>{pendingQ=`Why is the success rate at ${r.dataset.evask} so low today, and what should we do?`;go("assistant")});
  if(window.innerWidth<860){const bg=$("#boxGrid");if(bg)bg.style.gridTemplateColumns="1fr"}
}

let fleetFilter="all";
function attentionItems(){
  const items=[];
  heads.filter(h=>h.status==="Faulted"&&inScopeCharger(h.ch)).forEach(h=>{const hg=h.hangs.find(x=>x.ongoing);const dn=h.ch.down.find(x=>x.ongoing&&(!x.head||x.head===h.n));
    if(hg){const fails=h.sessions.filter(s=>s.t>=hg.start).length;items.push({sev:"bad",t:hg.start,title:hlabel(h),txt:`Faulted for ${Math.round((NOW-hg.start)/60000)} min · ${fails} failed starts at SLAC with different cars · auto-reset queued for when idle`,ch:h.ch.id})}
    else if(dn)items.push({sev:"bad",t:dn.start,title:hlabel(h),txt:`${dn.why} for ${Math.round((NOW-dn.start)/HOUR)} h · technician dispatched`,ch:h.ch.id})});
  sites.filter(s=>s.offlineNow&&(scope.cust==="all"||s.cust===scope.cust)&&(scope.site==="all"||scope.site===s.id)).forEach(s=>items.push({sev:"warn",t:s.offlineSince,title:s.name,txt:`All ${s.n} chargers silent for ${Math.round((NOW-s.offlineSince)/60000)} min · likely site power or internet`,ch:chargers.find(c=>c.site===s.id).id}));
  chargers.filter(c=>c.hotModule&&inScopeCharger(c)).forEach(c=>items.push({sev:"info",t:NOW,title:label(c),txt:`Module ${c.temps.length} at ${c.temps[c.temps.length-1]} °C, peers ${c.temps[0]} °C`,ch:c.id}));
  chargers.filter(c=>c.configDrift&&inScopeCharger(c)).forEach(c=>items.push({sev:"info",t:NOW,title:label(c),txt:"Config differs from baseline: DC-link pairing",ch:c.id}));
  return items;
}
function viewFleet(){
  const cs=scopeChargers();const hs=cs.flatMap(c=>c.heads);const cnt={};["Charging","Available","Preparing","Faulted","Offline"].forEach(k=>cnt[k]=hs.filter(h=>h.status===k).length);
  const groups=sites.filter(s=>cs.some(c=>c.site===s.id));
  const show=c=>fleetFilter==="all"||c.heads.some(h=>h.status===fleetFilter);
  const att=attentionItems();
  V.innerHTML=vh("Fleet monitor",`${esc(scopeName())} · live status of ${hs.length} connectors · updates every few seconds`,
   `<div class="chips" role="group" aria-label="Filter by status">${["all","Charging","Available","Preparing","Faulted","Offline"].map(k=>`<button class="chip" aria-pressed="${fleetFilter===k}" data-f="${k}" style="${fleetFilter===k?"border-color:var(--accent);font-weight:600":""}">${k==="all"?"All":k} ${k==="all"?hs.length:cnt[k]}</button>`).join("")}</div>`)+
  `<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(260px,340px);align-items:start" id="fleetGrid">
   <div class="card"><div class="legend" style="margin-bottom:12px">${["Charging","Available","Preparing","Faulted","Offline"].map(k=>`<span><i class="s-${k}"></i>${k}</span>`).join("")}<span>Each tile is a charger; the two bars are its heads.</span></div>
   ${groups.map(s=>{const cc=cs.filter(c=>c.site===s.id&&show(c));if(!cc.length)return"";return `<div class="sitegrp"><h4>${esc(s.name)} <span>${esc(custById[s.cust].name)} · ${esc(s.prov)}</span></h4><div class="tiles">${cc.map(c=>`<button class="tile" data-ch="${c.id}" aria-label="${esc(label(c))}: head 1 ${c.heads[0].status}, head 2 ${c.heads[1].status}"><span class="id">C${c.num}</span><span class="hs">${c.heads.map(h=>`<b class="s-${h.status}" title="H${h.n} ${h.status}"></b>`).join("")}</span></button>`).join("")}</div></div>`}).join("")||`<div class="empty">No connectors match this filter.</div>`}
   </div>
   <div class="card"><h3>Needs attention <small>${att.length}</small></h3><div class="att">${att.map(a=>`<div class="it ${a.sev==="bad"?"":a.sev}" data-ch="${a.ch}" role="button" tabindex="0"><b>${esc(a.title)}</b><span class="muted">${esc(a.txt)}</span></div>`).join("")||`<div class="empty">Nothing needs attention.</div>`}</div></div>
  </div>`;
  if(window.innerWidth<860)$("#fleetGrid").style.gridTemplateColumns="1fr";
  V.querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{fleetFilter=b.dataset.f;render()});
  V.querySelectorAll("[data-ch]").forEach(b=>{b.onclick=()=>go("charger",{charger:b.dataset.ch});b.onkeydown=e=>{if(e.key==="Enter")b.click()}});
}
// gentle live simulation
const simTimer=setInterval(()=>{const pool=heads.filter(h=>h.status==="Charging"||h.status==="Available"||h.status==="Preparing");for(let i=0;i<3;i++){const h=pool[Math.floor(Math.random()*pool.length)];h.status=h.status==="Charging"?"Available":h.status==="Available"?(Math.random()<.2?"Preparing":"Charging"):"Charging"}
  if(V&&V.isConnected&&current==="fleet"&&!document.hidden){const y=window.scrollY;viewFleet();window.scrollTo(0,y)}},6000);

function chargerPicker(){return `<label class="muted" for="pickCh" style="font-size:12.5px">Charger</label> <select id="pickCh">${sites.filter(s=>chargers.some(c=>c.site===s.id&&inScopeCharger(c))).map(s=>`<optgroup label="${esc(s.name)}">${chargers.filter(c=>c.site===s.id&&inScopeCharger(c)).map(c=>`<option value="${c.id}" ${c.id===sel.charger?"selected":""}>${esc(label(c))}</option>`).join("")}</optgroup>`).join("")}</select>`}
let logFilter="all";
function maintLog(c){
  const r=hashRng(c.id+"7"),ri2=(a,b)=>a+Math.floor(r()*(b-a+1));const L=[];
  const add=(t,type,what,by,down,res,k)=>{if(t<=NOW)L.push({t,type,what,by,down,res,k})};
  const tech=`Field team ${siteById[c.site].prov}`;
  // software history
  add(c.installed,"sw","Commissioned on firmware 2.3.5, OCPP 1.6J","EDS commissioning","–","Accepted","ok");
  const steps=[["2.3.7",NOW-230*DAY],["2.4.0",NOW-150*DAY],["2.4.1",NOW-75*DAY]];
  for(const [v,t0] of steps){const t=t0+ri2(0,20)*HOUR;if(t<c.installed)continue;if(c.fw==="2.3.7"&&v!=="2.3.7"){if(v==="2.4.1")add(t,"sw","Update to 2.4.1 skipped: charger offline during the rollout window","EDS software (OTA)","–","Pending","warn");continue}
    if(v==="2.4.0"&&r()<0.12){add(t,"sw","Update to 2.4.0","EDS software (OTA)","4 min","Rolled back after 6 h: SLAC failures rose","bad");add(t+3*DAY,"sw","Update to 2.4.0 re-applied with hotfix","EDS software (OTA)","4 min","Verified","ok")}
    else add(t,"sw",`Update to ${v}`,"EDS software (OTA)","4 min","Verified: success rate unchanged","ok")}
  if(c.fw==="2.5.0-rc2")add(DAY0+2*HOUR,"sw","Canary update to 2.5.0-rc2 (voltage-matched module switching)","EDS software (OTA)","5 min","Under observation","info");
  add(NOW-120*DAY+ri2(0,30)*HOUR,"cfg","OCPP backend URL moved to the CPO's v2 endpoint","EDS software","–","Verified","ok");
  if(c.cust==="sky"&&c.hw==="DC120")add(NOW-95*DAY,"cfg","Power split set to 40/80 kW per head (3 × 40 kW modules)","EDS software","–","Applied; differs from 60/60 kW in the contract","warn");
  if(c.configDrift){add(NOW-12*DAY+3*HOUR,"cfg","Flow update overwrote DC-link pairing","EDS software (OTA)","–","Drift detected by checksum","bad");add(NOW-12*DAY+5*HOUR,"cfg","Restore DC-link pairing from baseline","EDS software","–","Waiting for approval","warn")}
  // corrective maintenance
  const fixes={"Cable damage":"Replaced CCS2 cable and gun","Contactor fault":"Replaced DC output contactor","Cooling fan failure":"Replaced cooling fan, cleaned air filter","Insulation monitor fault":"Replaced insulation monitoring board"};
  c.down.forEach(x=>{const hrs=(Math.min(x.end,NOW)-x.start)/HOUR;const why=x.why.replace(/, head \d/,"");
    if(x.why==="Site offline")add(x.start,"cm","Site power or internet lost; restored by site staff","Site","" +hrs.toFixed(1)+" h","Restored","ok");
    else add(x.start,"cm",`${x.head?"Head "+x.head+": ":""}${why}. ${x.ongoing?"Technician dispatched, part ordered":fixes[why]}`,tech,x.ongoing?`${hrs.toFixed(0)} h so far`:hrs.toFixed(1)+" h",x.ongoing?"In progress":"Fixed, test charge passed",x.ongoing?"warn":"ok")});
  c.heads.forEach(h=>h.hangs.forEach(x=>{if(x.start>NOW)return;
    if(x.ongoing)add(NOW-5*60e3,"cm",`Head ${h.n}: SLAC failures; remote comm-stack reset queued for when idle`,"Auto-action (rule 1)",`${Math.round((NOW-x.start)/60000)} min so far`,"In progress","warn");
    else{const hrs=(x.end-x.start)/HOUR;add(x.end,"cm",`Head ${h.n}: stopped completing SLAC; remote controller reset`,hrs>6?"NOC engineer":"Auto-action (rule 1)",hrs.toFixed(1)+" h","Recovered; traces sent to controller vendor","ok")}}));
  if(c.dclink){add(c.dclink.to,"cm","DC-link contactor K12 to the paired charger replaced",tech,((c.dclink.to-c.dclink.from)/HOUR).toFixed(0)+" h at reduced power","Fixed, full power restored","ok")}
  if(c.hotModule)add(NOW-2*HOUR,"cm",`Module ${c.temps.length} running hot: fan check and filter clean booked for tomorrow`,tech,"–","Planned","info");
  const old=["Replaced RFID reader","Tightened DC busbar connections","Replaced cracked screen","Re-seated controller board connector","Replaced worn gun latch"];
  for(let i=0,n=ri2(0,2);i<n;i++){const t=NOW-ri2(35,200)*DAY;if(t>c.installed)add(t,"cm",`Head ${ri2(1,2)}: ${old[ri2(0,old.length-1)]}`,tech,(0.5+r()*5).toFixed(1)+" h","Fixed","ok")}
  return L.sort((a,b)=>b.t-a.t)}
function logCard(c){const L=maintLog(c);const f=L.filter(x=>logFilter==="all"||(logFilter==="cm"?x.type==="cm":x.type!=="cm"));
  const cmN=L.filter(x=>x.type==="cm").length,swN=L.length-cmN;const tl={cm:"Corrective",sw:"Software",cfg:"Config"};const tc={cm:"t-warn",sw:"t-info",cfg:"t-off"};
  return `<div class="card" style="margin-top:14px" id="logCard"><h3>Maintenance and software log <span class="chips" role="group" aria-label="Filter log">${[["all","All",L.length],["cm","Corrective maintenance",cmN],["sw","Software and config",swN]].map(([k,t,n])=>`<button class="chip" data-lf="${k}" aria-pressed="${logFilter===k}" style="${logFilter===k?"border-color:var(--accent);font-weight:600":""}">${t} ${n}</button>`).join("")}</span></h3>
  <div class="scroll" style="max-height:380px;overflow-y:auto"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>What was done</th><th>By</th><th class="n">Downtime</th><th>Result</th></tr></thead><tbody>
  ${f.map(x=>`<tr><td style="white-space:nowrap">${fmtD(x.t)} ${new Date(x.t).getFullYear()}<div class="muted" style="font-size:12px">${fmtT(x.t)}</div></td><td><span class="tag ${tc[x.type]}">${tl[x.type]}</span></td><td>${esc(x.what)}</td><td class="muted">${esc(x.by)}</td><td class="n" style="white-space:nowrap">${esc(x.down)}</td><td><span class="tag t-${x.k}">${esc(x.res)}</span></td></tr>`).join("")||`<tr><td colspan="6" class="empty">Nothing logged.</td></tr>`}</tbody></table></div>
  <p class="muted" style="font-size:12.5px;margin:10px 0 0">Corrective work comes from tickets and auto-actions; software and config changes come from the release system, so every fault can be checked against what changed just before it.</p></div>`}
function viewCharger(){
  let c=byId[sel.charger];if(!c||!inScopeCharger(c)){c=scopeChargers()[0];if(!c){V.innerHTML=`<div class="empty">No chargers in this scope.</div>`;return}sel.charger=c.id}
  const s=siteById[c.site],all=c.heads.flatMap(h=>h.sessions);const st=stats(all);
  const evs=[];c.heads.forEach(h=>h.hangs.forEach(x=>{if(x.start<NOW)evs.push({t:x.start,k:"bad",txt:`H${h.n} stopped completing SLAC${x.ongoing?" (ongoing)":` for ${((Math.min(x.end,NOW)-x.start)/HOUR).toFixed(1)} h`}`})}));
  c.down.forEach(x=>{if(x.start<NOW)evs.push({t:x.start,k:"bad",txt:`${x.head?"H"+x.head+" ":""}${x.why}${x.ongoing?" (ongoing)":` for ${((Math.min(x.end,NOW)-x.start)/HOUR).toFixed(1)} h`}`})});
  alerts.filter(a=>targetCharger(a.target)===c).forEach(a=>evs.push({t:a.t,k:"warn",txt:`Alert: ${a.title} → ${a.result}`}));
  tickets.filter(t=>targetCharger(t.target)===c).forEach(t=>evs.push({t:t.created,k:"info",txt:`Ticket ${t.id} opened (${t.status})`}));
  if(c.fw==="2.5.0-rc2")evs.push({t:DAY0+2*HOUR,k:"info",txt:"Running 2.5.0-rc2 as a canary"});
  evs.sort((a,b)=>b.t-a.t);
  const recent=all.slice().sort((a,b)=>b.t-a.t).slice(0,14);
  const stageRows=h=>{const x=stats(h.sessions);return Object.keys(FAIL_STAGE).map(k=>({l:FAIL_STAGE[k],v:x.by[k]||0,c:k==="slac"?"var(--bad)":k==="drop"?"var(--warn)":"var(--info)"}))};
  const mx=Math.max(1,...c.heads.flatMap(h=>stageRows(h).map(r=>r.v)));
  V.innerHTML=vh(label(c),`${esc(custById[c.cust].name)} · ${esc(s.prov)} · ${esc(HW[c.hw].name)} · firmware ${esc(c.fw)}`,`<div>${chargerPicker()}</div>`)+
  `<div class="kpis">${c.heads.map(h=>{const x=stats(h.sessions);return `<div class="kpi"><div class="l">Head ${h.n} · CCS2</div><div class="v">${statusTag(h.status)}</div><div class="s">${fmtPct(x.rate)} success rate · ${x.n} sessions</div></div>`}).join("")}
   <div class="kpi"><div class="l">Availability, 30 days</div><div class="v">${fmtAv(availability([c]))}</div><div class="s">${downHours(c).toFixed(1)} h down</div></div>
   <div class="kpi"><div class="l">Energy, 30 days</div><div class="v">${Math.round(st.kwh).toLocaleString()} kWh</div><div class="s">${st.n} sessions</div></div>
   <div class="kpi"><div class="l">Installed</div><div class="v" style="font-size:20px">${fmtD(c.installed)} ${new Date(c.installed).getFullYear()}</div><div class="s">${Math.round((NOW-c.installed)/DAY)} days in service</div></div></div>
  <div class="grid g2">
   <div class="card"><h3>Where each head fails <small>30 days</small></h3><div class="grid g2" style="gap:18px">${c.heads.map(h=>`<div><div class="muted" style="margin-bottom:6px">Head ${h.n}</div>${hbars(stageRows(h),{max:mx,lw:120})}</div>`).join("")}</div></div>
   <div class="card"><h3>Sessions per day <small>green completed, red failed</small></h3>${dailyStack(all)}</div>
   <div class="card"><h3>Power modules <small>temperature now</small></h3>${hbars(c.temps.map((t,i)=>({l:"Module "+(i+1),v:t,c:t>=70?"var(--bad)":"var(--ok)",s:t>=70?"hot":""})),{fmt:v=>v+" °C",max:90,lw:90})}
     <p class="muted" style="font-size:12.5px;margin:10px 0 0">${c.dclink?"DC link to the paired charger did not close between "+fmtD(c.dclink.from)+" and "+fmtD(c.dclink.to)+".":c.configDrift?"Configuration differs from the site baseline (DC-link pairing).":"Configuration matches the site baseline."}</p></div>
   <div class="card"><h3>Timeline <small>faults, alerts, tickets, releases</small></h3><div class="log" style="max-height:230px;background:none;padding:0">${evs.slice(0,14).map(e=>`<div style="display:grid;grid-template-columns:110px 1fr;gap:10px;border-bottom:1px solid var(--line);padding:5px 0"><span class="muted">${fmtDT(e.t)}</span><span><span class="tag t-${e.k}">${e.k==="bad"?"Fault":e.k==="warn"?"Alert":"Info"}</span> ${esc(e.txt)}</span></div>`).join("")||`<div class="muted">No events in 30 days.</div>`}</div></div>
  </div>
  ${logCard(c)}
  <div class="card" style="margin-top:14px"><h3>Recent sessions <small>select one to replay it</small></h3><div class="scroll"><table class="tbl"><thead><tr><th>Charge ID</th><th>Time</th><th>Head</th><th>Car</th><th>Result</th><th>Likely cause</th><th class="n">SOC</th><th class="n">Max kW</th><th class="n">kWh</th></tr></thead><tbody>
  ${recent.map(x=>`<tr class="click" data-s="${x.id}"><td class="mono" style="font-size:12.5px">${x.id}</td><td>${fmtDT(x.t)}</td><td>H${x.h.n}</td><td>${esc(MODELS[x.m].n)}</td><td>${x.out==="ok"?(x.lowKw||x.meter?`<span class="tag t-warn">Completed, flagged</span>`:`<span class="tag t-ok">Completed</span>`):`<span class="tag t-bad">${esc(failTxt(x.out))}</span>`}</td><td>${x.cause?esc(CAUSE[x.cause].t):"–"}</td><td class="n" style="white-space:nowrap">${(()=>{const p=buildTrace(x).perf;return p.socStart==null?"–":p.socEnd==null?p.socStart+"%":p.socStart+"→"+Math.round(p.socEnd)+"%"})()}</td><td class="n">${x.out==="ok"||x.out==="drop"?x.maxKw:"–"}</td><td class="n">${x.kwh}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("#pickCh").onchange=e=>{sel.charger=e.target.value;render()};
  V.querySelectorAll("[data-lf]").forEach(b=>b.onclick=()=>{logFilter=b.dataset.lf;const y=V.scrollTop;render();V.scrollTop=y});
  V.querySelectorAll("[data-s]").forEach(r=>r.onclick=()=>go("replay",{session:r.dataset.s}));
}
/* ============ replay (deep diagnostics) ============ */
function hashRng(id){return mulberry32(parseInt(String(id).replace(/\D/g,""),10)*2654435761>>>0)}
function realKwh(S){return S.meter?+(S.maxKw*S.dur/60*0.7).toFixed(1):S.kwh}
function limitReason(S){const hw=HW[S.h.ch.hw],mo=MODELS[S.m];if(S.lowKw)return"DC link open on the charger";if(S.maxKw>=mo.kw-1)return"the car's own limit";if(Math.abs(S.maxKw-hw.kw*0.5)<2)return`sharing modules with head ${S.h.n===1?2:1}`;if(S.maxKw>=hw.kw-1)return"the charger's rating";return"the charger's available power"}
function buildTrace(S){
  const r=hashRng(S.id),u=(a,b)=>a+r()*(b-a);const mo=MODELS[S.m],cust=custById[S.h.ch.cust],hw=HW[S.h.ch.hw];const cap=CAP[mo.n]||60;
  const P=[];let t=0;const push=(k,name,d,color,fail=false)=>{P.push({k,name,t0:t,t1:t+d,color,fail});t+=d};
  const fail=S.out;let end=false;
  if(fail==="slac"){push("slac","SLAC",50,"var(--bad)",true);end=true}else push("slac","SLAC",u(2.5,6),"#9DB4A9");
  if(!end){if(fail==="auth"){push("auth",cust.auth==="app"?"Waiting for app scan":"Waiting for RemoteStart",120,"var(--bad)",true);end=true}else push("auth",cust.auth==="app"?"App scan":"RFID",cust.auth==="app"?u(14,95):u(2,5),"#B9C7A3")}
  if(!end){if(fail==="contract"){push("contract","ContractAuth",20,"var(--bad)",true);end=true}else push("contract","Contract",u(1,3),"#C6B98F")}
  if(!end)push("cable","CableCheck",u(2,4),"#CDBF95");
  if(!end){if(fail==="pre"){push("pre","PreCharge",10,"var(--bad)",true);end=true}else push("pre","PreCharge",u(3.5,8),"#D3B27F")}
  let E=null,Eend=null,dipAt=null;const d=S.dur*60;
  if(!end){E=t;if(S.dip)dipAt=t+d-1.2;push("energy","CurrentDemand",d,fail==="drop"?"#E6A37E":"#7FC4A8",fail==="drop");Eend=t;push("stop",fail==="drop"?"EV stop":"Stop",3,fail==="drop"?"var(--bad)":"#9DB4A9",fail==="drop");if(fail==="drop")push("post","Stopped, still plugged in",Math.max(60,d*0.5),"#D5DED9")}
  const T=t;const socKnown=!!P.find(p=>p.k==="contract"&&!p.fail);
  const ratio=E!=null?Math.min(0.92,Math.max(0.5,realKwh(S)/(Math.max(1,S.maxKw)*d/3600))):0;
  const gEnd=Math.min(1,Math.max(0,2*(ratio-0.1)/0.9-1));const g=f=>f<0.1?1:1-(1-gEnd)*(f-0.1)/0.9;
  const evMaxV=Math.round(400+r()*40),evMaxI=Math.round(mo.kw*1000/330);
  const sibCharging=S.h.ch.heads.find(x=>x!==S.h).sessions.some(x=>x.out==="ok"&&x.t<S.t+T*1000&&x.t+x.dur*60e3>S.t);
  const offerKw=S.maxKw<mo.kw-1?S.maxKw:hw.kw*(sibCharging?0.5:1);
  // sample times
  const ts=[];const preEnd=E??T;for(let k=0;k<=70;k++)ts.push(preEnd*k/70);
  if(E!=null){for(let k=1;k<=260;k++)ts.push(E+d*k/260);if(S.dip)ts.push(dipAt,dipAt+0.2,dipAt+0.5,dipAt+0.9);for(let k=1;k<=24;k++)ts.push(Eend+(T-Eend)*k/24)}
  ts.sort((a,b)=>a-b);
  let cumE=0,soc=S.soc0,gun=31,prevT=0;const smp=[];
  for(const tt of ts){const ph=P.find(p=>tt>=p.t0&&tt<=p.t1)||P[P.length-1];let vP=0,vT=0,iP=0,iReq=0,iLim=0,pw=0,iso=null,mods=0,cpS="B",lim="";
    const pack=330+0.9*soc;
    if(ph.k==="cable"){const f=(tt-ph.t0)/(ph.t1-ph.t0);vP=f<0.8?Math.min(500,500*f/0.4):500*(1-(f-0.8)/0.2);vT=500;iso=Math.round(1450+r()*300)}
    if(ph.k==="pre"){const f=Math.min(1,(tt-ph.t0)/Math.min(5,ph.t1-ph.t0));vT=Math.round(pack);vP=ph.fail?(pack-70)*Math.min(1,(tt-ph.t0)/6):pack*f;iP=ph.fail?0:1.2;mods=hw.mods}
    if(E!=null&&tt>=E&&tt<=Eend){cpS="C";const f=(tt-E)/d;const ramp=Math.min(1,(tt-E)/25);
      let p=S.maxKw*ramp*g(f);const req=mo.kw*ramp*g(f);
      if(S.dip&&tt>=dipAt)p=p*Math.max(0,1-(tt-dipAt)/0.8);if(fail==="drop"&&!S.dip&&f>0.995)p=0;
      vP=pack+(p>0?4:0);if(S.dip&&tt>=dipAt&&tt<dipAt+1.2)vP-=22*(1-(tt-dipAt)/1.2);
      vT=evMaxV;pw=p;iP=p*1000/vP;iReq=Math.min(evMaxI,Math.max(req,p)*1000/vP);iLim=offerKw*1000/vP;
      if(S.dip&&tt>=dipAt)iReq=0;
      mods=S.dip&&tt>=dipAt?1:Math.min(hw.mods,Math.ceil(offerKw/40));
      lim=iP<1?"":iReq>iP+2?"Charger":"Car";
      cumE+=p*(tt-prevT)/3600;soc=Math.min(100,S.soc0+cumE/cap*100)}
    if(Eend!=null&&tt>Eend)cpS="B";
    gun+=((31+Math.pow(iP/200,2)*28)-gun)*Math.min(1,(tt-prevT)/90);prevT=tt;
    smp.push({t:tt,ph:ph.name,k:ph.k,cp:cpS,vP:+vP.toFixed(1),vT,iP:+iP.toFixed(1),iReq:+iReq.toFixed(1),iLim:+iLim.toFixed(1),pw:+pw.toFixed(1),soc:socKnown?+soc.toFixed(1):null,gun:+gun.toFixed(1),iso,mods,lim})}
  const sib=S.h.ch.heads.find(x=>x!==S.h);const sibEv=[];
  if(S.dip)sibEv.push({t:dipAt,txt:`H${sib.n} starts, modules move`});
  else{const ov=sib.sessions.find(x=>x.out==="ok"&&x.t<S.t+T*1000&&x.t+x.dur*60e3>S.t);if(ov)sibEv.push({t:Math.max(0,(ov.t-S.t)/1000),txt:`H${sib.n} charging`,span:Math.min(T,(ov.t+ov.dur*60e3-S.t)/1000)})}
  const en=smp.filter(s=>s.k==="energy"&&s.iP>1);
  const carT=en.filter(s=>s.lim==="Car").length,chgT=en.filter(s=>s.lim==="Charger").length;
  const perf={socStart:socKnown?S.soc0:null,socEnd:socKnown&&E!=null?+soc.toFixed(1):null,kwh:+cumE.toFixed(2),peakKw:en.length?Math.max(...en.map(s=>s.pw)):0,avgKw:en.length?+(cumE/(d/3600)).toFixed(1):0,peakA:en.length?Math.max(...en.map(s=>s.iP)):0,
    carPct:en.length?carT/en.length:0,chgPct:en.length?chgT/en.length:0,reason:(Math.abs(S.maxKw-hw.kw*0.5)<2&&!S.lowKw&&S.maxKw<mo.kw-1&&!sibCharging)?`this head's fixed power split (${S.maxKw} kW of ${hw.kw} kW)`:limitReason(S),evMaxV,evMaxI,cap,offerKw,gunMax:Math.max(...smp.map(s=>s.gun))};
  return{P,T,E,Eend,dipAt,sibEv,sib,smp,perf,Vt:Math.round(330+0.9*S.soc0)}}
function v2gRows(S,tr){const R=[];const mo=MODELS[S.m];const at=s=>tsStr(S,s);
  tr.P.forEach(p=>{if(p.k==="slac")R.push([at(p.t0),"SLAC",p.fail?"CM_SLAC_PARM.REQ not received; TT_EVSE_SLAC_init expired":"CM_SLAC_MATCH.CNF · EVCCID "+mo.n.split(" ")[0].slice(0,3).toUpperCase()+S.id.slice(-4)]);
    if(p.k==="auth"&&!p.fail){R.push([at(p.t0),"SessionSetup","ResponseCode OK · SessionID "+S.id.slice(-6)]);R.push([at(p.t0+0.4),"ServiceDiscovery","EnergyTransferMode DC_extended"]);R.push([at(p.t1-0.3),"PaymentSelection",custById[S.h.ch.cust].auth==="app"?"ExternalPayment (CPO app)":"ExternalPayment (RFID)"])}
    if(p.k==="contract")R.push([at(p.t0),"Authorization",p.fail?"EV did not send AuthorizationReq · V2G_SECC_Sequence_Timeout":"EVSEProcessing Finished"]);
    if(p.k==="cable"){R.push([at(p.t0-0.2),"ChargeParameterDiscovery",`EVMaximumVoltageLimit ${tr.perf.evMaxV} V · EVMaximumCurrentLimit ${tr.perf.evMaxI} A · EVEnergyCapacity ${tr.perf.cap} kWh · EVRESSSOC ${S.soc0}% · EVSEMaximumPowerLimit ${Math.round(tr.perf.offerKw)} kW`]);
      R.push([at(p.t1),"CableCheck",`EVSEIsolationStatus Valid · R_iso ${tr.smp.find(s=>s.iso)?.iso||1500} kΩ`])}
    if(p.k==="pre")R.push([at(p.t1),"PreCharge",p.fail?`EVTargetVoltage ${tr.Vt} V · EVSEPresentVoltage did not converge · EVErrorCode FAILED_EVSEPresentVoltage`:`EVTargetVoltage ${tr.Vt} V · EVSEPresentVoltage ${tr.Vt} V`]);
    if(p.k==="energy")R.push([at(p.t0),"PowerDelivery","ChargeProgress Start"])});
  return R}
function tsStr(S,s){const d=new Date(S.t+s*1000);return d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Asia/Bangkok"})}
function deepTables(S,tr){
  const en=tr.smp.filter(s=>s.k==="energy");const meterStart=1048000+parseInt(S.id.slice(-3),10)*7;
  // OCPP MeterValues every 60 s
  const mv=[];let next=tr.E;let cum=0,prev=tr.E;
  en.forEach(s=>{cum+=s.pw*(s.t-prev)/3600;prev=s.t;if(s.t>=next){mv.push({...s,reg:Math.round(meterStart+cum*1000)});next+=60}});
  if(en.length){const l=en[en.length-1];mv.push({...l,reg:Math.round(meterStart+tr.perf.kwh*1000)})}
  const meterStop=S.meter?meterStart:Math.round(meterStart+tr.perf.kwh*1000);
  // V2G CurrentDemand every ~15 s
  const cd=[];let n2=tr.E;en.forEach(s=>{if(s.t>=n2||s===en[en.length-1]){cd.push(s);n2+=15}});if(tr.dipAt)tr.smp.filter(s=>s.t>=tr.dipAt-0.3&&s.t<=tr.dipAt+1).forEach(s=>{if(!cd.includes(s))cd.push(s)});cd.sort((a,b)=>a.t-b.t);
  const rem=s=>s.pw>5&&s.soc!=null?Math.max(0,Math.round(((100-s.soc)/100*tr.perf.cap)/Math.max(5,s.pw)*60)):"–";
  // controller every 30 s plus phase changes
  const ct=[];let n3=0,lastPh="";tr.smp.forEach(s=>{if(s.t>=n3||s.ph!==lastPh){ct.push(s);n3=s.t+30;lastPh=s.ph}});
  return{mv,meterStart,meterStop,cd,rem,ct}}
let tlSpan=72,clickMode="open",compareMode="none";
function pickCompare(S){const hs=S.h.sessions;const i=hs.indexOf(S);
  if(compareMode==="prev")return i>0?hs[i-1]:null;
  if(compareMode==="prevok")return hs.slice(0,i).reverse().find(x=>x.out==="ok"&&!x.lowKw&&!x.meter)||null;
  if(compareMode==="model"){const c=S.h.ch.heads.flatMap(h=>h.sessions).filter(x=>x.m===S.m&&x!==S&&x.out==="ok"&&!x.lowKw).sort((a,b)=>b.t-a.t);return c.find(x=>x.t<S.t)||c[0]||sessions.filter(x=>x.m===S.m&&x.out==="ok"&&!x.lowKw&&x.h.ch.hw===S.h.ch.hw).slice(-1)[0]||null}
  if(compareMode==="custom")return sessions.find(x=>x.id===sel.compare)||null;return null}
function stepDur(tr,k){const p=tr.P.find(x=>x.k===k);return p?p.t1-p.t0:null}
function sessTimeline(S,C){
  const ch=S.h.ch,span=tlSpan*HOUR,wEnd=Math.min(NOW+HOUR,S.t+span*0.3),wStart=wEnd-span;const px=t=>(100*(t-wStart)/span);
  const ticks=[];const step=tlSpan<=24?3:tlSpan<=72?12:24;const BKK=7*HOUR;let tk=Math.ceil((wStart+BKK)/(step*HOUR))*step*HOUR-BKK;for(;tk<wEnd;tk+=step*HOUR)ticks.push(tk);
  const bands=[];ch.heads.forEach(h=>h.hangs.forEach(x=>{if(x.end>wStart&&x.start<wEnd)bands.push({h:h.n,a:Math.max(x.start,wStart),b:Math.min(x.end,wEnd,NOW),t:"Controller hang"})}));
  ch.down.forEach(x=>{if(x.end>wStart&&x.start<wEnd)[1,2].forEach(n=>{if(!x.head||x.head===n)bands.push({h:n,a:Math.max(x.start,wStart),b:Math.min(x.end,wEnd,NOW),t:x.why})})});
  const marks=[];alerts.filter(a=>targetCharger(a.target)===ch&&a.t>wStart&&a.t<wEnd).forEach(a=>marks.push({t:a.t,k:"alert",txt:"Alert: "+a.title}));
  maintLog(ch).filter(x=>x.type!=="cm"&&x.t>wStart&&x.t<wEnd).forEach(x=>marks.push({t:x.t,k:"sw",txt:x.what}));
  const row=h=>{const ss=h.sessions.filter(x=>x.t+x.dur*60e3>wStart&&x.t<wEnd);
    return `<div class="tlrow"><span class="lb">H${h.n}</span><div class="tltrack">${bands.filter(b=>b.h===h.n).map(b=>`<div class="tlband" style="left:${px(b.a)}%;width:${px(b.b)-px(b.a)}%" title="${esc(b.t)}"></div>`).join("")}
    ${ss.map(x=>{const st=x.out!=="ok"?"bad":x.lowKw||x.meter?"warn":"ok";const w=Math.max(0,100*x.dur*60e3/span);return `<button class="tlb tl-${st}${x===S?" sel":""}${x===C?" cmp":""}" style="left:${px(x.t)}%;width:${w}%" data-sid="${x.id}" title="${fmtDT(x.t)} · ${esc(MODELS[x.m].n)} · ${x.out==="ok"?(st==="warn"?"completed, flagged":"completed"):"failed at "+FAIL_STAGE[x.out]}" aria-label="${fmtDT(x.t)} ${esc(MODELS[x.m].n)} ${x.out==="ok"?"completed":"failed"}"></button>`}).join("")}</div></div>`};
  return `<div class="card" style="margin-bottom:14px"><h3>Sessions on ${esc(label(ch))} <span class="chips">${[24,72,168].map(v=>`<button class="chip" data-span="${v}" aria-pressed="${tlSpan===v}" style="${tlSpan===v?"border-color:var(--accent);font-weight:600":""}">${v===168?"7 days":v+" h"}</button>`).join("")}</span></h3>
   <div class="tlbar"><div class="seg2" role="group" aria-label="What a click does"><span class="muted" style="font-size:12.5px">Click a session to</span><button class="chip" data-cm="open" aria-pressed="${clickMode==="open"}" style="${clickMode==="open"?"border-color:var(--accent);font-weight:600":""}">open it</button><button class="chip" data-cm="compare" aria-pressed="${clickMode==="compare"}" style="${clickMode==="compare"?"border-color:var(--accent);font-weight:600":""}">compare with it</button></div>
   <div style="display:flex;gap:8px;align-items:center"><button class="btn" id="prevS" aria-label="Previous session on this head">← Previous</button><button class="btn" id="nextS" aria-label="Next session on this head">Next →</button></div></div>
   <div class="tl">${ch.heads.map(row).join("")}
    <div class="tlrow"><span class="lb"></span><div class="tlaxis">${ticks.map(t=>`<span style="left:${px(t)}%">${fmtT(t)==="00:00"||step>=24?fmtD(t)+" ":""}${step<24&&fmtT(t)!=="00:00"?fmtT(t):""}</span>`).join("")}${NOW<wEnd?`<span class="now" style="left:${px(NOW)}%">now</span>`:""}</div></div>
    <div class="tlrow"><span class="lb"></span><div class="tlmarks">${marks.map(m=>`<i class="mk mk-${m.k}" style="left:${px(m.t)}%" title="${esc(fmtDT(m.t)+" · "+m.txt)}"></i>`).join("")}</div></div>
   </div>
   <div class="legend" style="margin-top:8px"><span><i style="background:var(--ok)"></i>Completed</span><span><i style="background:var(--warn)"></i>Completed, flagged</span><span><i style="background:var(--bad)"></i>Failed</span><span><i style="background:var(--bad-soft);border:1px solid var(--bad)"></i>Head down</span><span><i class="mk mk-alert" style="position:static;display:inline-block"></i>Alert</span><span><i class="mk mk-sw" style="position:static;display:inline-block"></i>Software or config change</span><span>Solid outline: open session · dashed: compared session · ← → keys step through sessions</span></div></div>`}
function compareTable(S,C,tr,tc){
  const f=(v,u="",d=1)=>v==null?"–":(typeof v==="number"?(+v).toFixed(d):v)+u;
  const rows=[
   ["When",fmtDT(S.t),fmtDT(C.t),""],["Head",hlabel(S.h),hlabel(C.h),""],["Car",MODELS[S.m].n,MODELS[C.m].n,S.m!==C.m?"different car":""],
   ["Result",S.out==="ok"?"Completed":failTxt(S.out),C.out==="ok"?"Completed":failTxt(C.out),S.out!==C.out?"different":""],
   ["SOC",tr.perf.socStart!=null?`${tr.perf.socStart}% → ${tr.perf.socEnd??"–"}%`:"not received",tc.perf.socStart!=null?`${tc.perf.socStart}% → ${tc.perf.socEnd??"–"}%`:"not received",""],
   ["Energy",f(tr.perf.kwh," kWh"),f(tc.perf.kwh," kWh"),""],
   ["Peak power",f(tr.perf.peakKw," kW",0),f(tc.perf.peakKw," kW",0),tc.perf.peakKw>0&&Math.abs(tr.perf.peakKw-tc.perf.peakKw)/tc.perf.peakKw>0.2?`${tr.perf.peakKw>tc.perf.peakKw?"+":""}${Math.round(tr.perf.peakKw-tc.perf.peakKw)} kW`:""],
   ["Average power",f(tr.perf.avgKw," kW"),f(tc.perf.avgKw," kW"),""],
   ["Peak current",f(tr.perf.peakA," A",0),f(tc.perf.peakA," A",0),""],
   ["Limited by",tr.E==null?"–":tr.perf.chgPct>tr.perf.carPct?"Charger: "+tr.perf.reason:"Car",tc.E==null?"–":tc.perf.chgPct>tc.perf.carPct?"Charger: "+tc.perf.reason:"Car",""]];
  [["slac","SLAC"],["auth","Authorisation"],["contract","ContractAuth"],["cable","CableCheck"],["pre","PreCharge"],["energy","Charging"]].forEach(([k,n])=>{const a=stepDur(tr,k),b=stepDur(tc,k);const fm=v=>v==null?"not reached":v>=120?(v/60).toFixed(1)+" min":v.toFixed(1)+" s";
    rows.push([n+" time",fm(a),fm(b),a!=null&&b!=null&&k!=="energy"&&a>2*b&&a-b>3?`${(a/b).toFixed(1)}× slower`:a==null&&b!=null?"did not reach":""])});
  rows.push(["Gun peak",f(tr.perf.gunMax," °C",0),f(tc.perf.gunMax," °C",0),""],["Charger firmware",S.h.ch.fw,C.h.ch.fw,S.h.ch.fw!==C.h.ch.fw?"different":""]);
  const diffs=rows.filter(r=>r[3]);
  const insight=diffs.length?`Biggest differences: ${diffs.slice(0,3).map(r=>`${r[0].toLowerCase()} (${r[1]} vs ${r[2]})`).join("; ")}.`:"No notable difference between the two sessions.";
  return `<div class="card" style="margin-top:14px"><h3>Compared side by side <small>${esc(insight)}</small></h3><div class="scroll"><table class="tbl"><thead><tr><th></th><th>Open · <span class="mono muted">${S.id}</span></th><th>Compared · <span class="mono muted">${C.id}</span></th><th>Difference</th></tr></thead><tbody>
  ${rows.map(r=>`<tr${r[3]?' style="background:var(--warn-soft)"':""}><td class="muted">${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${r[3]?`<b>${esc(r[3])}</b>`:""}</td></tr>`).join("")}</tbody></table></div></div>`}

let railHead="all",railFailed=false,railOrder=[];
function sessRail(S,C){
  const ch=S.h.ch,span=tlSpan*HOUR,wEnd=NOW+HOUR,wStart=Math.min(S.t-HOUR,NOW-span);
  const hs=ch.heads.filter(h=>railHead==="all"||h.n===+railHead);
  let ss=hs.flatMap(h=>h.sessions).filter(x=>x.t>=wStart&&x.t<=wEnd&&(!railFailed||x.out!=="ok"||x.lowKw||x.meter||x===S||x===C));
  ss.sort((a,b)=>b.t-a.t);railOrder=ss.map(x=>x.id);
  const ev=[];alerts.filter(a=>targetCharger(a.target)===ch&&a.t>wStart&&a.t<wEnd).forEach(a=>ev.push({t:a.t,k:"alert",txt:a.title.replace(label(ch)+" ","")}));
  maintLog(ch).filter(x=>x.t>wStart&&x.t<wEnd).forEach(x=>ev.push({t:x.t,k:x.type==="cm"?"cm":"sw",txt:x.what}));
  ch.heads.forEach(h=>{if(railHead!=="all"&&h.n!==+railHead)return;h.hangs.forEach(x=>{if(x.start>wStart&&x.start<wEnd)ev.push({t:x.start,k:"down",txt:`H${h.n} stopped completing SLAC${x.ongoing?" (ongoing)":""}`})})});
  ch.down.forEach(x=>{if(x.start>wStart&&x.start<wEnd&&(railHead==="all"||!x.head||x.head===+railHead))ev.push({t:x.start,k:"down",txt:`${x.head?"H"+x.head+" ":""}down: ${x.why.replace(/, head \d/,"")}`})});
  const items=[...ss.map(x=>({t:x.t,s:x})),...ev].sort((a,b)=>b.t-a.t);
  const nf=ss.filter(x=>x.out!=="ok").length;const maxKw=HW[ch.hw].kw;
  let day="",html="";
  items.forEach(it=>{const d=fmtD(it.t);if(d!==day){day=d;html+=`<div class="rday">${d}${d===fmtD(NOW)?" · today":""}</div>`}
    if(it.s){const x=it.s,mo=MODELS[x.m],st=x.out!=="ok"?"bad":x.lowKw||x.meter?"warn":"ok";
      const socEnd=Math.min(100,Math.round(x.soc0+realKwh(x)/(CAP[mo.n]||60)*100));
      const res=x.out==="ok"?(x.lowKw?"Completed · low power":x.meter?"Completed · billed 0 kWh":"Completed"):failTxt(x.out);
      const meta=x.out==="ok"||x.out==="drop"?`${x.soc0}→${socEnd}% · ${realKwh(x)} kWh · ${x.maxKw} kW`:(x.cause?CAUSE[x.cause].t:"");
      html+=`<div class="ri${x===S?" sel":""}${x===C?" cmp":""}"><span class="rt">${fmtT(x.t)}</span><span class="rd"><i class="st-${st}"></i></span>
       <button class="rc" data-sid="${x.id}" aria-current="${x===S}"><span class="rh"><b>H${x.h.n} · ${esc(mo.n)}</b><span class="tag ${st==="ok"?"t-ok":st==="warn"?"t-warn":"t-bad"}">${esc(res)}</span></span><span class="muted rm">${esc(meta)}</span>${x.out==="ok"||x.out==="drop"?`<span class="rbar"><i style="width:${Math.max(4,100*x.maxKw/maxKw)}%;background:var(--${st==="ok"?"ok":st==="warn"?"warn":"bad"})"></i></span>`:""}</button>
       ${x!==S?`<button class="rcmp" data-cmp="${x.id}" aria-pressed="${x===C}" title="${x===C?"Stop comparing":"Compare with the open session"}">${x===C?"Comparing":"Compare"}</button>`:`<span class="rcmp open">Open</span>`}</div>`}
    else html+=`<div class="re"><span class="rt">${fmtT(it.t)}</span><span class="rd"><i class="ev-${it.k}"></i></span><span class="rtx">${esc(it.txt)}</span></div>`});
  return `<aside class="rpl" aria-label="Sessions on this charger"><div class="rpl-head">
   <label class="muted" for="railCh" style="font-size:12.5px">Charger</label><select id="railCh" style="width:100%;margin-top:2px">${sites.filter(s=>chargers.some(c=>c.site===s.id&&inScopeCharger(c))).map(s=>`<optgroup label="${esc(s.name)}">${chargers.filter(c=>c.site===s.id&&inScopeCharger(c)).map(c=>`<option value="${c.id}" ${c===ch?"selected":""}>${esc(label(c))}</option>`).join("")}</optgroup>`).join("")}${inScopeCharger(ch)?"":`<option value="${ch.id}" selected>${esc(label(ch))}</option>`}</select>
   <div class="chips" style="margin-top:8px">${[["all","Both heads"],["1","H1"],["2","H2"]].map(([k,t])=>`<button class="chip sm" data-hf="${k}" aria-pressed="${railHead===k}">${t}</button>`).join("")}<button class="chip sm" data-fo aria-pressed="${railFailed}">Problems only</button></div>
   <div class="chips" style="margin-top:6px">${[24,72,168].map(v=>`<button class="chip sm" data-span="${v}" aria-pressed="${tlSpan===v}">${v===168?"7 days":v+" h"}</button>`).join("")}</div>
   <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px;flex-wrap:wrap"><span class="muted" style="font-size:12.5px">${ss.length} sessions · ${nf} failed</span><span style="display:flex;gap:6px"><button class="btn sm" id="newerS" title="Newer session (↑)">↑ Newer</button><button class="btn sm" id="olderS" title="Older session (↓)">↓ Older</button></span></div>
  </div><div class="rpl-list" id="railList">${html||`<div class="empty">No sessions in this range.</div>`}</div></aside>`}

function vTimeline(S,C){
  const ch=S.h.ch,span=tlSpan*HOUR,pxh=tlSpan<=24?30:tlSpan<=72?12:5;
  const wEnd=Math.min(NOW+HOUR,Math.max(S.t+span*0.3,NOW-span+span)),wStart=Math.min(S.t-2*HOUR,wEnd-span);
  const H=Math.round((wEnd-wStart)/HOUR*pxh);const y=t=>Math.round((wEnd-t)/HOUR*pxh);
  const step=tlSpan<=24?3:tlSpan<=72?12:24;const BKK=7*HOUR;let tk=Math.ceil((wStart+BKK)/(step*HOUR))*step*HOUR-BKK;const ticks=[];for(;tk<wEnd;tk+=step*HOUR)ticks.push(tk);
  const bands=[];ch.heads.forEach(h=>h.hangs.forEach(x=>{if(x.end>wStart&&x.start<wEnd)bands.push({h:h.n,a:Math.max(x.start,wStart),b:Math.min(x.end,wEnd,NOW),t:"Controller hang"})}));
  ch.down.forEach(x=>{if(x.end>wStart&&x.start<wEnd)[1,2].forEach(n=>{if(!x.head||x.head===n)bands.push({h:n,a:Math.max(x.start,wStart),b:Math.min(x.end,wEnd,NOW),t:x.why.replace(/, head \d/,"")})})});
  const marks=[];alerts.filter(a=>targetCharger(a.target)===ch&&a.t>wStart&&a.t<wEnd).forEach(a=>marks.push({t:a.t,k:"alert",txt:"Alert: "+a.title}));
  maintLog(ch).filter(x=>x.type!=="cm"&&x.t>wStart&&x.t<wEnd).forEach(x=>marks.push({t:x.t,k:"sw",txt:x.what}));
  const all=ch.heads.flatMap(h=>h.sessions).filter(x=>x.t+x.dur*60e3>wStart&&x.t<wEnd).sort((a,b)=>b.t-a.t);railOrder=all.map(x=>x.id);
  const col=h=>`<div class="vcol">${bands.filter(b=>b.h===h.n).map(b=>`<div class="vband" style="top:${y(b.b)}px;height:${Math.max(2,y(b.a)-y(b.b))}px" title="${esc(b.t)}"></div>`).join("")}
    ${h.sessions.filter(x=>x.t+x.dur*60e3>wStart&&x.t<wEnd).map(x=>{const st=x.out!=="ok"?"bad":x.lowKw||x.meter?"warn":"ok";const top=y(x.t+x.dur*60e3),hh=Math.max(7,y(x.t)-top);
      return `<button class="vb tl-${st}${x===S?" sel":""}${x===C?" cmp":""}" style="top:${top}px;height:${hh}px" data-sid="${x.id}" title="${x.id} · ${fmtDT(x.t)} · ${esc(MODELS[x.m].n)} · ${x.out==="ok"?(st==="warn"?"completed, flagged":"completed"):esc(failTxt(x.out).toLowerCase())}" aria-label="${fmtDT(x.t)} ${esc(MODELS[x.m].n)} ${x.out==="ok"?"completed":"failed"}">${hh>=18?`<span>${fmtT(x.t)} ${esc(MODELS[x.m].n)}</span>`:""}</button>`}).join("")}</div>`;
  return `<aside class="vtlcard" aria-label="Sessions on this charger"><div class="rpl-head">
   <label class="muted" for="railCh" style="font-size:12.5px">Sessions on charger</label><select id="railCh" style="width:100%;margin-top:2px">${sites.filter(s=>chargers.some(c=>c.site===s.id&&inScopeCharger(c))).map(s=>`<optgroup label="${esc(s.name)}">${chargers.filter(c=>c.site===s.id&&inScopeCharger(c)).map(c=>`<option value="${c.id}" ${c===ch?"selected":""}>${esc(label(c))}</option>`).join("")}</optgroup>`).join("")}${inScopeCharger(ch)?"":`<option value="${ch.id}" selected>${esc(label(ch))}</option>`}</select>
   <div class="chips" style="margin-top:8px">${[24,72,168].map(v=>`<button class="chip sm" data-span="${v}" aria-pressed="${tlSpan===v}">${v===168?"7 days":v+" h"}</button>`).join("")}</div>
   <div class="seg2" style="margin-top:6px"><span class="muted" style="font-size:12.5px">Click a session to</span><button class="chip sm" data-cm="open" aria-pressed="${clickMode==="open"}">open it</button><button class="chip sm" data-cm="compare" aria-pressed="${clickMode==="compare"}">compare</button></div>
   <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px;flex-wrap:wrap"><span class="muted" style="font-size:12.5px">${all.length} sessions · ${all.filter(x=>x.out!=="ok").length} failed</span><span style="display:flex;gap:6px"><button class="btn sm" id="newerS" title="Newer session (↑)">↑ Newer</button><button class="btn sm" id="olderS" title="Older session (↓)">↓ Older</button></span></div></div>
   <div class="vhead"><span></span><span>H1</span><span>H2</span><span title="Alerts and changes">Events</span></div>
   <div class="vscroll" id="vtl"><div class="vgrid" style="height:${H}px">
    <div class="vaxis">${ticks.map(t=>`<span style="top:${y(t)}px">${fmtT(t)==="00:00"||step>=24?fmtD(t):fmtT(t)}</span>`).join("")}${NOW<wEnd?`<span class="now" style="top:${y(NOW)}px">now</span>`:""}</div>
    ${ticks.map(t=>`<div class="vtick" style="top:${y(t)}px"></div>`).join("")}${NOW<wEnd?`<div class="vtick nowl" style="top:${y(NOW)}px"></div>`:""}
    ${ch.heads.map(col).join("")}
    <div class="vcol vev">${marks.map(m=>`<i class="mk mk-${m.k}" style="top:${y(m.t)}px" title="${esc(fmtDT(m.t)+" · "+m.txt)}"></i>`).join("")}</div>
   </div></div>
   <div class="legend vleg"><span><i style="background:var(--ok)"></i>Completed</span><span><i style="background:var(--warn)"></i>Flagged</span><span><i style="background:var(--bad)"></i>Failed</span><span><i style="background:var(--bad-soft);border:1px solid var(--bad)"></i>Head down</span><span><i class="mk mk-alert" style="position:static;display:inline-block;transform:rotate(45deg)"></i>Alert</span><span><i class="mk mk-sw" style="position:static;display:inline-block;transform:rotate(45deg)"></i>Software or config</span><span>Solid outline: open · dashed: compared · ↑ ↓ keys step</span></div></aside>`}

let deepTab="v2g",cursorIdx=null;
function viewReplay(){
  if(replayMode==="upload"&&upl){viewUpload();return}
  let S=sessions.find(x=>x.id===sel.session);const list=interesting();
  if(!S){S=list.find(x=>x.cause==="ps")||list[0]||sessions[sessions.length-1];sel.session=S.id}
  const C=pickCompare(S);const tr=buildTrace(S),pf=tr.perf;const tc=C?buildTrace(C):null;const W=900;
  const both=tc?[tr,tc]:[tr];const linear=both.some(x=>x.E==null);const Tmax=Math.max(...both.map(x=>x.T));const Dspan=linear?1:Math.max(...both.map(x=>x.T-x.E));
  const mk=x=>s=>linear?W*s/Tmax:(s<=x.E?0.22*W*s/x.E:0.22*W+0.78*W*(s-x.E)/Dspan);
  const mapX=mk(tr),mapC=tc?mk(tc):null;
  const pct=s=>(100*mapX(s)/W).toFixed(2)+"%";
  const segs=tr.P.map(p=>`<div class="seg" style="left:${pct(p.t0)};width:calc(${pct(p.t1)} - ${pct(p.t0)});background:${p.color}" title="${esc(p.name)} ${(p.t1-p.t0).toFixed(0)} s">${esc(p.name)}</div>`).join("");
  const cp=tr.E==null?`<div class="seg" style="left:0;width:100%;background:#C9D6CF">B · connected</div>`:`<div class="seg" style="left:0;width:${pct(tr.E)};background:#C9D6CF">B · connected</div><div class="seg" style="left:${pct(tr.E)};width:calc(${pct(tr.Eend)} - ${pct(tr.E)});background:#8FBCE8">C · charging</div>${tr.Eend<tr.T-4?`<div class="seg" style="left:${pct(tr.Eend)};width:calc(100% - ${pct(tr.Eend)});background:#C9D6CF">B</div>`:""}`;
  const mods=HW[S.h.ch.hw].mods;
  const modLane=tr.E==null?`<div class="seg" style="left:0;width:100%;background:var(--panel2);color:var(--muted)">no modules assigned</div>`:S.dip?`<div class="seg" style="left:${pct(tr.E)};width:calc(${pct(tr.dipAt)} - ${pct(tr.E)});background:#A9D3C2">${mods} modules</div><div class="seg" style="left:${pct(tr.dipAt)};width:calc(${pct(tr.Eend)} - ${pct(tr.dipAt)});background:#E8B98E">1</div>`:`<div class="seg" style="left:${pct(tr.E)};width:calc(${pct(tr.Eend)} - ${pct(tr.E)});background:#A9D3C2">${S.lowKw?mods-1+" of "+mods+" (link open)":Math.min(mods,Math.ceil(pf.offerKw/40))+" of "+mods+" modules"}</div>`;
  const sib=tr.sibEv.map(e=>e.span?`<div class="seg" style="left:${pct(e.t)};width:calc(${pct(e.span)} - ${pct(e.t)});background:#C8BFE6">${esc(e.txt)}</div>`:`<div class="seg" style="left:${pct(e.t)};width:190px;max-width:calc(100% - ${pct(e.t)});background:var(--scope-mark);color:#fff">${esc(e.txt)}</div>`).join("")||`<div class="seg" style="left:0;width:100%;background:transparent;color:var(--muted)">idle</div>`;
  // 3-panel scope
  const PH=120,gap=26,top=10,Ht=top+3*PH+2*gap+22;const sm=tr.smp;
  const vmax=520,imax=Math.max(60,...sm.map(s=>Math.max(s.iP,s.iReq,s.iLim)),...(tc?tc.smp.map(s=>s.iP):[0]))*1.08,pmax=Math.max(20,...sm.map(s=>s.pw),pf.offerKw,...(tc?tc.smp.map(s=>s.pw):[0]))*1.1;
  const y0=k=>top+k*(PH+gap);const yy=(k,v,mx)=>y0(k)+PH*(1-Math.max(0,Math.min(1,v/mx)));
  const line=(k,key,mx,col,dash="",w=2)=>{const pts=sm.filter(s=>s[key]!=null&&!(key==="iLim"&&s.k!=="energy")&&!(key==="vT"&&!s.vT)&&!(key==="iReq"&&s.k!=="energy")).map(s=>`${mapX(s.t).toFixed(1)},${yy(k,s[key],mx).toFixed(1)}`).join(" ");return pts?`<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="${w}" ${dash?`stroke-dasharray="${dash}"`:""}/>`:""};
  let g="";for(let k=0;k<3;k++){for(let q=0;q<=4;q++){const y=y0(k)+PH*q/4;g+=`<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="var(--scope-grid)"/>`}for(let q=0;q<=12;q++)g+=`<line y1="${y0(k)}" y2="${y0(k)+PH}" x1="${W*q/12}" x2="${W*q/12}" stroke="var(--scope-grid)"/>`}
  const lab=(k,txt)=>`<text x="6" y="${y0(k)+12}" font-size="11" fill="#A9C2B9">${esc(txt)}</text>`;
  g+=lab(0,`Voltage · 0–${vmax} V`)+lab(1,`Current · 0–${Math.round(imax)} A`)+lab(2,`Power · 0–${Math.round(pmax)} kW   |   SOC · 0–100%`);
  const lineC=(k,key,mx,col)=>{if(!tc)return"";const pts=tc.smp.filter(s=>s[key]!=null).map(s=>`${mapC(s.t).toFixed(1)},${yy(k,s[key],mx).toFixed(1)}`).join(" ");return `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="3" opacity=".28"/>`};
  if(tc){g+=lineC(0,"vP",vmax,"var(--scope-v)")+lineC(1,"iP",imax,"var(--scope-i)")+lineC(2,"pw",pmax,"var(--scope-p)")+(tc.smp.some(s=>s.soc!=null&&s.k==="energy")?lineC(2,"soc",100,"var(--scope-soc)"):"")}
  g+=line(0,"vT",vmax,"var(--scope-v)","5 5",1.5)+line(0,"vP",vmax,"var(--scope-v)");
  g+=line(1,"iLim",imax,"var(--scope-lim)","7 5",1.6)+line(1,"iReq",imax,"var(--scope-i)","4 4",1.5)+line(1,"iP",imax,"var(--scope-i)");
  g+=line(2,"pw",pmax,"var(--scope-p)")+(sm.some(s=>s.soc!=null&&s.k==="energy")?line(2,"soc",100,"var(--scope-soc)"):"");
  if(tr.E!=null)g+=`<line x1="${mapX(tr.E)}" x2="${mapX(tr.E)}" y1="${top}" y2="${Ht-22}" stroke="#56706A" stroke-dasharray="3 4"/><text x="${mapX(tr.E)+6}" y="${Ht-6}" font-size="11" fill="#9FB8AF">energy starts · time axis compressed before this line</text>`;
  if(tr.dipAt)g+=`<line x1="${mapX(tr.dipAt)}" x2="${mapX(tr.dipAt)}" y1="${top}" y2="${Ht-22}" stroke="var(--scope-mark)" stroke-width="2"/>`;
  g+=`<line id="cur" x1="0" x2="0" y1="${top}" y2="${Ht-22}" stroke="#FFFFFF" stroke-width="1" opacity="0"/><rect id="hov" x="0" y="0" width="${W}" height="${Ht}" fill="transparent"/>`;
  const sum=replaySummary(S,tr);const log=replayLog(S,tr);const mo=MODELS[S.m];const dt=deepTables(S,tr);const v2=v2gRows(S,tr);
  const perfTxt=tr.E==null?"No energy was delivered, so there is no SOC or power data beyond the step that failed.":
    `Power was limited by ${pf.chgPct>pf.carPct?esc(pf.reason):"the car"} for most of the session (car ${Math.round(pf.carPct*100)}%, charger ${Math.round(pf.chgPct*100)}% of charging time). ${mo.n} accepts up to ${mo.kw} kW; this head offered ${Math.round(pf.offerKw)} kW.${pf.gunMax>55?` Gun reached ${pf.gunMax.toFixed(0)} °C.`:""}`;
  const meterRow=S.meter?`<tr class="er"><td>${tsStr(S,tr.Eend+3)}</td><td colspan="8">StopTransaction meterStop ${dt.meterStop} Wh = meterStart ${dt.meterStart} Wh, but the MeterValues above show ${pf.kwh} kWh delivered</td></tr>`:"";
  const tabs={v2g:"ISO 15118 / DIN 70121",ocpp:"OCPP 1.6J MeterValues",ctrl:"Controller"};
  let tbl="";
  if(deepTab==="ocpp")tbl=dt.mv.length?`<table class="tbl mono deep"><thead><tr><th>Time</th><th class="n">Energy.Active.Import.Register (Wh)</th><th class="n">Power.Active.Import (kW)</th><th class="n">Current.Import (A)</th><th class="n">Voltage (V)</th><th class="n">SoC (%)</th><th class="n">Current.Offered (A)</th><th class="n">Power.Offered (kW)</th><th class="n">Temperature (°C)</th></tr></thead><tbody>${dt.mv.map(s=>`<tr><td>${tsStr(S,s.t)}</td><td class="n">${s.reg.toLocaleString()}</td><td class="n">${s.pw.toFixed(1)}</td><td class="n">${s.iP.toFixed(0)}</td><td class="n">${s.vP.toFixed(0)}</td><td class="n">${s.soc??"–"}</td><td class="n">${s.iLim.toFixed(0)}</td><td class="n">${Math.round(pf.offerKw)}</td><td class="n">${s.gun.toFixed(0)}</td></tr>`).join("")}${meterRow}</tbody></table>`:`<div class="empty">No MeterValues: the transaction never started.</div>`;
  if(deepTab==="v2g")tbl=`<table class="tbl mono deep"><thead><tr><th>Time</th><th>Message</th><th class="n">EVTarget V</th><th class="n">EVTarget A</th><th class="n">EVRESSSOC</th><th class="n">Remaining min</th><th class="n">EVSEPresent V</th><th class="n">EVSEPresent A</th><th class="n">EVSEMax A</th><th>Limit achieved</th></tr></thead><tbody>
    ${v2.map(rw=>`<tr class="${/not|expired|Timeout|FAILED/.test(rw[2])?"er":""}"><td>${rw[0]}</td><td>${esc(rw[1])}</td><td colspan="8">${esc(rw[2])}</td></tr>`).join("")}
    ${dt.cd.map(s=>`<tr class="${s.iReq===0&&s.k==="energy"&&S.dip?"er":""}"><td>${tsStr(S,s.t)}</td><td>CurrentDemand</td><td class="n">${s.vT}</td><td class="n">${s.iReq.toFixed(0)}</td><td class="n">${s.soc??"–"}</td><td class="n">${dt.rem(s)}</td><td class="n">${s.vP.toFixed(1)}</td><td class="n">${s.iP.toFixed(0)}</td><td class="n">${s.iLim.toFixed(0)}</td><td>${s.lim==="Charger"?"Current yes":s.iP>1?"No":"–"}</td></tr>`).join("")}
    ${tr.E!=null?`<tr class="${S.out==="drop"?"er":""}"><td>${tsStr(S,tr.Eend)}</td><td>PowerDelivery</td><td colspan="8">ChargeProgress Stop${S.dip?" · EVErrorCode FAILED_EVSEPresentVoltage (EV-initiated)":S.out==="drop"?(S.cause==="cpo"?" · after OCPP RemoteStopTransaction":" · EV stopped responding"):" · BulkChargingComplete true"}</td></tr><tr><td>${tsStr(S,tr.Eend+1)}</td><td>WeldingDetection / SessionStop</td><td colspan="8">EVSEPresentVoltage &lt; 60 V · contactors open</td></tr>`:""}</tbody></table>`;
  if(deepTab==="ctrl")tbl=`<table class="tbl mono deep"><thead><tr><th>Time</th><th>Step</th><th>CP</th><th class="n">PWM %</th><th>K1/K2</th><th class="n">R_iso kΩ</th><th class="n">Modules</th><th class="n">Out V</th><th class="n">Out A</th><th class="n">Gun °C</th><th>DC link</th></tr></thead><tbody>${dt.ct.map(s=>`<tr><td>${tsStr(S,s.t)}</td><td>${esc(s.ph)}</td><td>${s.cp}</td><td class="n">5</td><td>${s.k==="energy"||s.k==="pre"?"closed":"open"}</td><td class="n">${s.iso??"–"}</td><td class="n">${s.mods||0}/${mods}</td><td class="n">${s.vP.toFixed(0)}</td><td class="n">${s.iP.toFixed(0)}</td><td class="n">${s.gun.toFixed(0)}</td><td>${S.lowKw?"K12 open":S.h.ch.hw==="DC60"?"–":"ok"}</td></tr>`).join("")}</tbody></table>`;
  const railY=$("#vtl")?.scrollTop;
  V.innerHTML=vh("Session replay",`${esc(hlabel(S.h))} · ${esc(custById[S.h.ch.cust].name)} · ${esc(mo.n)} · ${fmtDT(S.t)} · Charge ID <span class="mono">${S.id}</span>`,
   `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center"><div><label class="muted" for="cmpSel" style="font-size:12.5px">Compare with</label> <select id="cmpSel"><option value="none">Nothing</option><option value="prev">Previous session on this head</option><option value="prevok">Previous completed session on this head</option><option value="model">Last good session of the same car model</option><option value="custom" ${compareMode==="custom"?"":"disabled"}>Session picked on the timeline</option></select></div><div><label class="muted" for="pickS" style="font-size:12.5px">Jump to a notable session</label> <select id="pickS">${list.map(x=>`<option value="${x.id}" ${x.id===S.id?"selected":""}>${fmtDT(x.t)} · ${esc(hlabel(x.h))} · ${esc(CAUSE[x.cause]?.t||"ok")}</option>`).join("")}${list.some(x=>x.id===S.id)?"":`<option value="${S.id}" selected>${fmtDT(S.t)} · ${esc(hlabel(S.h))}</option>`}</select></div></div>`)+uploadBar()+
  `<div class="summary ${sum.ok?"ok":""}" style="margin-bottom:14px"><b>${sum.ok?"Completed":"Diagnosis"}:</b> ${esc(sum.txt)} ${S.out!=="ok"||S.lowKw||S.meter?`<div class="muted" style="margin-top:4px;font-size:12.5px">Owner: ${esc(CAUSE[S.cause]?.o||"–")} · rules engine, confidence ${S.cause==="unknown"?"low":"high"}</div>`:""}</div>
  <div class="kpis">
   <div class="kpi"><div class="l">State of charge</div><div class="v">${pf.socStart!=null?pf.socStart+"% → "+(pf.socEnd??"–")+"%":"not received"}</div><div class="s">battery ${pf.cap} kWh</div></div>
   <div class="kpi"><div class="l">Energy delivered</div><div class="v">${pf.kwh} kWh</div><div class="s">${S.meter?"billed 0 kWh":"billed "+pf.kwh.toFixed(1)+" kWh"}</div></div>
   <div class="kpi"><div class="l">Peak / average power</div><div class="v">${tr.E==null?"–":Math.round(pf.peakKw)+" / "+pf.avgKw+" kW"}</div><div class="s">car max ${mo.kw} kW${tr.E!=null?" · offered "+Math.round(pf.offerKw)+" kW":""}</div></div>
   <div class="kpi"><div class="l">Peak current</div><div class="v">${tr.E==null?"–":Math.round(pf.peakA)+" A"}</div><div class="s">car limit ${pf.evMaxI} A</div></div>
   <div class="kpi"><div class="l">Limited by</div><div class="v" style="font-size:20px">${tr.E==null?"–":pf.chgPct>pf.carPct?"Charger":"Car"}</div><div class="s">${tr.E==null?"no energy phase":esc(pf.chgPct>pf.carPct?pf.reason:"car's charging curve")}</div></div>
  </div>
  <div class="rp">${vTimeline(S,C)}<div class="rpr"><div class="card"><h3>Timeline <small>${tr.T<300?Math.round(tr.T)+" s":Math.round(tr.T/60)+" min"} from plug-in</small></h3>
   <div class="lanes">
    <span class="lb">Control pilot</span><div class="lane">${cp}</div>
    <span class="lb">Charging step</span><div class="lane">${segs}</div>
    <span class="lb">Modules on this head</span><div class="lane">${modLane}</div>
    <span class="lb">Sibling head H${tr.sib.n}</span><div class="lane">${sib}</div>
    ${tc?`<span class="lb">Compared session</span><div class="lane">${tc.P.map(p=>`<div class="seg" style="left:${(100*mapC(p.t0)/W).toFixed(2)}%;width:${(100*(mapC(p.t1)-mapC(p.t0))/W).toFixed(2)}%;background:${p.color};opacity:.75" title="${esc(p.name)} ${(p.t1-p.t0).toFixed(0)} s">${esc(p.name)}</div>`).join("")}</div>`:""}
   </div>
   <div class="scopewrap"><div class="scopebox"><svg viewBox="0 0 ${W} ${Ht}" width="100%" role="img" aria-label="Voltage, current, power and state of charge over the session" id="scopeSvg">${g}</svg>
   <div class="legend" style="color:#9FB8AF"><span><i style="background:var(--scope-v)"></i>Output voltage (dashed: EV target)</span><span><i style="background:var(--scope-i)"></i>Output current (dashed: EV request)</span><span><i style="background:var(--scope-lim)"></i>Charger current limit</span><span><i style="background:var(--scope-p)"></i>Power</span><span><i style="background:var(--scope-soc)"></i>State of charge</span>${tr.dipAt?`<span><i style="background:var(--scope-mark)"></i>Sibling head starts</span>`:""}${tc?`<span><i style="background:#9FB8AF;opacity:.5"></i>Wide faded lines: compared session</span>`:""}</div>
   <label style="display:flex;gap:10px;align-items:center;margin-top:8px;font-size:12.5px;color:#9FB8AF">Inspect a moment <input type="range" id="curR" min="0" max="${sm.length-1}" value="${cursorIdx??Math.min(sm.length-1,Math.round(sm.length*0.6))}" style="flex:1"></label></div>
   <div class="readout" id="readout" aria-live="polite"></div></div>
   <p style="margin:10px 0 0;font-size:13px">${perfTxt}</p>
  </div>
  ${tc?compareTable(S,C,tr,tc):(compareMode!=="none"?`<div class="card" style="margin-top:14px"><div class="empty">No session matches “${esc($("#cmpSel")?.selectedOptions?.[0]?.text||"this comparison")}” for this session.</div></div>`:"")}
  <div class="card" style="margin-top:14px"><h3>Deep log <span class="chips" role="group" aria-label="Log source">${Object.entries(tabs).map(([k,t])=>`<button class="chip" data-tab="${k}" aria-pressed="${deepTab===k}" style="${deepTab===k?"border-color:var(--accent);font-weight:600":""}">${t}</button>`).join("")}<button class="chip" id="csvBtn" style="display:none">Download CSV</button></span></h3>
   <div class="scroll" style="max-height:340px;overflow:auto">${tbl}</div>
   <p class="muted" style="font-size:12.5px;margin:8px 0 0">${deepTab==="ocpp"?"Sampled every 60 s, as configured in MeterValueSampleInterval. SoC comes from the car over ISO 15118 / DIN 70121.":deepTab==="v2g"?"CurrentDemand runs every 250 ms on the wire; shown here every 15 s and around every event.":"Controller snapshots every 30 s and at every step change."}</p></div>
  <div class="grid g2" style="margin-top:14px">
   <div class="card"><h3>Messages <small>OCPP, controller and V2G, merged by time</small></h3><div class="log mono">${log.map(l=>`<div class="${l.er?"er":""}">${l.time}  ${l.src.padEnd(4," ")}  ${esc(l.msg)}</div>`).join("")}</div></div>
   <div class="card"><h3>Session facts</h3><table class="tbl"><tbody>
    <tr><td class="muted">Charge ID</td><td class="mono">${S.id}</td></tr><tr><td class="muted">Charger</td><td>${esc(HW[S.h.ch.hw].name)} · FW ${esc(S.h.ch.fw)}</td></tr>
    <tr><td class="muted">Car</td><td>${esc(mo.n)} · ${pf.cap} kWh · max ${mo.kw} kW · ${pf.evMaxV} V / ${pf.evMaxI} A limits</td></tr>
    <tr><td class="muted">Result</td><td>${S.out==="ok"?"Completed":esc(failTxt(S.out))}</td></tr>
    <tr><td class="muted">Energy</td><td>${pf.kwh} kWh measured${S.meter?", 0 kWh billed":""}</td></tr>
    <tr><td class="muted">Gun temperature</td><td>peak ${pf.gunMax.toFixed(0)} °C</td></tr>
   </tbody></table>
   <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn" id="toCh">Open Charger 360</button><button class="btn" id="askAI">Ask the AI assistant</button></div></div>
  </div></div></div>`;
  {const rl=$("#vtl");if(railY!=null)rl.scrollTop=railY;const se=rl.querySelector(".vb.sel");if(se){const a=se.offsetTop,b=a+se.offsetHeight;if(railY==null||a<rl.scrollTop+20||b>rl.scrollTop+rl.clientHeight-20)rl.scrollTop=Math.max(0,a-rl.clientHeight/3)}}
  // cursor
  const svg=$("#scopeSvg"),cur=$("#cur"),ro=$("#readout"),rng=$("#curR");
  const show=i=>{i=Math.max(0,Math.min(sm.length-1,i));cursorIdx=i;const s=sm[i];const x=mapX(s.t);cur.setAttribute("x1",x);cur.setAttribute("x2",x);cur.setAttribute("opacity",".8");rng.value=i;
    ro.innerHTML=`<b>${tsStr(S,s.t)}</b><span class="muted">${esc(s.ph)} · CP ${s.cp}</span><dl>
     <dt>Voltage</dt><dd>${s.vP.toFixed(1)} V${s.vT?` <span class="muted">target ${s.vT}</span>`:""}</dd>
     <dt>Current</dt><dd>${s.iP.toFixed(0)} A</dd><dt>EV request</dt><dd>${s.k==="energy"?s.iReq.toFixed(0)+" A":"–"}</dd><dt>Charger limit</dt><dd>${s.k==="energy"?s.iLim.toFixed(0)+" A":"–"}</dd>
     <dt>Power</dt><dd>${s.pw.toFixed(1)} kW</dd><dt>SOC</dt><dd>${s.soc!=null?s.soc+"%":"not received"}</dd>
     <dt>Modules</dt><dd>${s.mods}/${mods}</dd><dt>Gun</dt><dd>${s.gun.toFixed(0)} °C</dd>${s.iso?`<dt>R_iso</dt><dd>${s.iso} kΩ</dd>`:""}
     <dt>Limited by</dt><dd>${s.lim||"–"}</dd></dl>${tc?(()=>{const x=mapX(s.t);let bi=0,bd=1e9;tc.smp.forEach((q,j)=>{const dd=Math.abs(mapC(q.t)-x);if(dd<bd){bd=dd;bi=j}});const q=tc.smp[bi];return `<div class="muted" style="margin-top:8px;border-top:1px solid var(--line);padding-top:6px">Compared, same point</div><dl><dt>Step</dt><dd>${esc(q.ph)}</dd><dt>Voltage</dt><dd>${q.vP.toFixed(1)} V</dd><dt>Current</dt><dd>${q.iP.toFixed(0)} A</dd><dt>Power</dt><dd>${q.pw.toFixed(1)} kW</dd><dt>SOC</dt><dd>${q.soc!=null?q.soc+"%":"–"}</dd></dl>`})():""}`};
  const idxAt=x=>{let best=0,bd=1e9;sm.forEach((s,i)=>{const dd=Math.abs(mapX(s.t)-x);if(dd<bd){bd=dd;best=i}});return best};
  $("#hov").addEventListener("mousemove",e=>{const b=svg.getBoundingClientRect();show(idxAt((e.clientX-b.left)/b.width*W))});
  rng.oninput=e=>show(+e.target.value);show(+rng.value);
  $("#pickS").onchange=e=>{sel.session=e.target.value;cursorIdx=null;render()};
  $("#cmpSel").value=compareMode;$("#cmpSel").onchange=e=>{compareMode=e.target.value;render()};
  const keepY=f=>{const y=V.scrollTop,wy=window.scrollY;f();render();V.scrollTop=y;window.scrollTo(0,wy)};
  V.querySelectorAll("[data-span]").forEach(b=>b.onclick=()=>keepY(()=>{tlSpan=+b.dataset.span}));
  V.querySelectorAll("[data-sid]").forEach(b=>b.onclick=()=>keepY(()=>{if(clickMode==="compare"&&b.dataset.sid!==S.id){if(compareMode==="custom"&&sel.compare===b.dataset.sid){compareMode="none";sel.compare=null}else{sel.compare=b.dataset.sid;compareMode="custom"}}else{sel.session=b.dataset.sid;cursorIdx=null}}));
  V.querySelectorAll("[data-cm]").forEach(b=>b.onclick=()=>keepY(()=>{clickMode=b.dataset.cm}));
  $("#railCh").onchange=e=>{const c=byId[e.target.value];const l=c.heads.flatMap(h=>h.sessions).sort((a,b)=>b.t-a.t);const pick=l.find(x=>x.out!=="ok")||l[0];if(pick){sel.session=pick.id;sel.charger=c.id;cursorIdx=null;if(compareMode==="custom")compareMode="none";render()}};
  const ix=railOrder.indexOf(S.id);$("#newerS").disabled=ix<=0;$("#olderS").disabled=ix<0||ix>=railOrder.length-1;
  $("#newerS").onclick=()=>keepY(()=>{sel.session=railOrder[ix-1];cursorIdx=null});$("#olderS").onclick=()=>keepY(()=>{sel.session=railOrder[ix+1];cursorIdx=null});
  V.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{deepTab=b.dataset.tab;const y=V.scrollTop;render();V.scrollTop=y});
  $("#toCh").onclick=()=>go("charger",{charger:S.h.ch.id});
  $("#askAI").onclick=()=>{pendingQ=`Why did charge ${S.id} on ${hlabel(S.h)} ${S.out==="ok"?"get flagged":"fail"}, and what should we do?`;go("assistant")};
  bindUploadBar();
  (window.claude&&window.claude.use?window.claude.use("downloads"):Promise.resolve(null)).then(dl=>{const b=$("#csvBtn");if(!dl||!b)return;b.style.display="";b.onclick=async()=>{
    const head="time,step,cp,ev_target_v,output_v,ev_request_a,output_a,charger_limit_a,power_kw,soc_pct,modules,gun_c,r_iso_kohm,limited_by";
    const rows=sm.map(s=>[tsStr(S,s.t),s.ph,s.cp,s.vT,s.vP,s.iReq,s.iP,s.iLim,s.pw,s.soc??"",s.mods,s.gun,s.iso??"",s.lim].join(","));
    try{await dl.save({filename:`${S.id}_${S.h.id}.csv`,data:[head,...rows].join("\n")})}catch(e){}}}).catch(()=>{});
}

function replayLog(S,tr){
  const L=[];const at=s=>fmtT(S.t+s*1000)+":"+String(Math.floor((S.t/1000+s)%60)).padStart(2,"0");const mo=MODELS[S.m];
  L.push([0,"OCPP","StatusNotification Preparing"]);
  tr.P.forEach(p=>{
    if(p.k==="slac")L.push([p.t0,"CTRL",p.fail?"CP=B, CM_SLAC_PARM.REQ not received ... timeout after 50 s":"SLAC matched, EVCCID "+(mo.n.split(" ")[0].toUpperCase().slice(0,3))+"-"+S.id.slice(-4)]);
    if(p.k==="auth")L.push([p.t0,"OCPP",p.fail?(S.cause==="cpo"?"RemoteStartTransaction not received (backend offline)":"Authorisation window 120 s expired before app scan"):(custById[S.h.ch.cust].auth==="app"?"RemoteStartTransaction accepted":"Authorize idTag accepted")]);
    if(p.k==="contract")L.push([p.t0,"V2G",p.fail?"ContractAuthenticationReq not sent by EV ... SequenceTimeout":"ContractAuthenticationRes OK"]);
    if(p.k==="pre")L.push([p.t0,"V2G",p.fail?"PreChargeReq target "+(tr.Vt)+" V, EVSE present voltage did not converge in 10 s":"PreChargeRes EVSEPresentVoltage "+tr.Vt+" V"]);
    if(p.k==="energy"){L.push([p.t0,"OCPP","StartTransaction "+S.id+" meterStart 1048"+S.id.slice(-3)]);L.push([p.t0+30,"V2G",`CurrentDemandReq EVTargetCurrent ${Math.round(S.maxKw*1000/tr.Vt/(S.lowKw?0.62:1))} A`]);
      if(S.lowKw)L.push([p.t0+31,"CTRL","DC link contactor K12 open; modules available 2 of 3"]);
      if(S.dip){L.push([tr.dipAt-1,"CTRL",`H${tr.sib.n} plug-in, module group reallocation 3→1`]);L.push([tr.dipAt,"V2G","EVSEPresentVoltage deviation −22 V in 180 ms"]);L.push([tr.dipAt+0.6,"V2G","EV ChargeProgress=Stop, EVErrorCode=FAILED_EVSEPresentVoltage"])}
      else if(S.out==="drop")L.push([p.t1-1,"V2G",S.cause==="cpo"?"RemoteStopTransaction received from CPO":"EV stopped responding (CurrentDemandReq timeout)"])}
    if(p.k==="stop")L.push([p.t0,"OCPP",`StopTransaction reason=${S.out==="ok"?"EVDisconnected":S.cause==="cpo"?"Remote":"Other"} meterStop 1048${S.meter?S.id.slice(-3):Math.round(+S.id.slice(-3)+S.kwh*1000)}`])});
  if(S.out!=="ok"&&S.out!=="drop")L.push([tr.T,"OCPP","StatusNotification Faulted → Available"]);
  return L.map(([s,src,msg])=>({time:at(s),src,msg,er:/timeout|not |deviation|Stop,|Faulted|expired|open;/.test(msg)}));
}
function replaySummary(S,tr){
  const mo=MODELS[S.m];const h=S.h;
  if(S.out==="ok"&&!S.lowKw&&!S.meter)return{ok:true,txt:`Session completed normally. ${S.kwh} kWh in ${S.dur} min at up to ${S.maxKw} kW.`};
  switch(S.cause){
    case"hang":{const ep=h.hangs.find(x=>S.t>=x.start&&S.t<=x.end);const prev=h.sessions.filter(x=>x.t>=ep.start&&x.t<=S.t);const ms=[...new Set(prev.map(x=>MODELS[x.m].n))];
      return{txt:`Controller or PLC hang. The charger never completed SLAC (control pilot stayed at B, no SLAC response for 50 s). This head has failed ${prev.length} session${prev.length>1?"s":""} the same way since ${fmtT(ep.start)}, with ${ms.length} different car model${ms.length>1?"s":""} (${ms.slice(0,3).join(", ")}), while head ${tr.sib.n} kept charging. A communication-stack reset is the fix; the vendor needs these traces for a permanent one.`}}
    case"ps":return{txt:`Power-sharing voltage swing. When head ${tr.sib.n} started, modules were reallocated and the output voltage dropped 22 V in 180 ms. The ${mo.n} treats a deviation of about 20 V as a fault and stopped within a second. Firmware ${h.ch.fw} on ${h.ch.hw} has this behaviour; 2.5.0 ramps modules in with voltage matching.`};
    case"dclink":return{txt:`DC link stuck. The car asked for about ${Math.round(S.maxKw/0.62)} kW but the charger delivered ${S.maxKw} kW because the DC-link contactor to the paired charger stayed open. Not a car problem.`};
    case"meter":return{txt:`Zero-energy billing. meterStart equals meterStop although ${S.dur} minutes of current flowed. The meter read raced StopTransaction. Integrated power gives the real energy; billing was corrected.`};
    case"timeout":return{txt:`Authorisation timeout. The car was ready, but the driver started from the app after the 120-second window. Not a charger fault; a plug-first flow or a longer window would save this session.`};
    case"vehfw":return{txt:`Vehicle firmware. The ${mo.n} never sent ContractAuthenticationReq. This is a known issue on some production lots and needs a firmware update from the importer. Other models charge normally on this head.`};
    case"veh":return{txt:`Vehicle communication. The ${mo.n} stopped responding at ${FAIL_STAGE[S.out]}. The head's other sessions are healthy, so this points to the car; check the compatibility matrix for this model.`};
    case"cpo":return{txt:S.out==="auth"?`CPO backend offline. The app could not send RemoteStartTransaction during the backend outage.`:`CPO remote stop. The backend sent RemoteStopTransaction mid-session. Check the CPO's stop rules for this payment method.`};
    default:return{txt:`Unclassified. The ${mo.n} stopped at ${FAIL_STAGE[S.out]||"an unknown step"} with no rule matching. Send to the classifier queue or an engineer.`};
  }}
function interesting(){const ss=scopeSessions().filter(s=>s.out!=="ok"||s.lowKw||s.meter).slice(-400);const pick={};const out=[];
  ["ps","hang","dclink","meter","timeout","vehfw","veh","cpo","unknown"].forEach(c=>{ss.filter(s=>s.cause===c).slice(-3).reverse().forEach(s=>out.push(s))});return out.sort((a,b)=>b.t-a.t).slice(0,24)}

/* ============ uploaded log analysis ============ */
let replayMode="fleet",upl=null,uplAbort=null,uplCursor=null;
const parseTs=s=>{if(!s)return null;s=s.trim();let m=s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/);
  if(m){const d=Date.parse(m[0].replace(" ","T")+(m[6]?"":"+07:00"));return isNaN(d)?null:d}
  m=s.match(/^(\d{1,2}):(\d{2}):(\d{2})(\.\d+)?/);if(m)return((+m[1])*3600+(+m[2])*60+(+m[3])+(m[4]?+m[4]:0))*1000;return null};
const num=v=>{const x=parseFloat(String(v).replace(",","."));return isFinite(x)?x:null};
function mergeSample(map,ts,obj){const k=Math.round(ts/100);const s=map.get(k)||{ts};for(const[a,b]of Object.entries(obj))if(b!=null)s[a]=b;map.set(k,s)}
function parseOCPP(lines){const map=new Map(),ev=[],meta={};const pend={};
  lines.forEach(line=>{const i=line.indexOf("[");if(i<0)return;let fr;try{fr=JSON.parse(line.slice(i))}catch(e){return}if(!Array.isArray(fr))return;
    const ts=parseTs(line.slice(0,i));const typ=fr[0];
    if(typ===2){const[,id,act,p0]=fr;const p=p0||{};pend[id]=act;const t=ts??(p.timestamp?parseTs(p.timestamp):null);
      if(act==="MeterValues"){(p.meterValue||[]).forEach(mv=>{const tt=parseTs(mv.timestamp)??t;const o={};(mv.sampledValue||[]).forEach(sv=>{const v=num(sv.value);const ms=sv.measurand||"Energy.Active.Import.Register";const u=(sv.unit||"").toLowerCase();
          if(ms==="Voltage")o.vP=v;else if(ms==="Current.Import")o.iP=v;else if(ms==="Current.Offered")o.iLim=v;else if(ms==="Power.Active.Import")o.pw=u==="w"?v/1000:v;else if(ms==="SoC")o.soc=v;else if(ms==="Temperature")o.gun=v;else if(ms==="Energy.Active.Import.Register")o.energy=u==="kwh"?v:v/1000});
          if(tt!=null)mergeSample(map,tt,o)});if(p.transactionId!=null)meta.transactionId=p.transactionId}
      else if(act!=="Heartbeat"){let txt=act;if(act==="StatusNotification")txt+=` ${p.status}${p.errorCode&&p.errorCode!=="NoError"?" · errorCode "+p.errorCode:""}${p.info?" · "+p.info:""}`;
        if(act==="StartTransaction"){txt+=` meterStart ${p.meterStart} Wh · idTag ${p.idTag||"–"}`;meta.meterStart=p.meterStart;meta.connectorId=p.connectorId}
        if(act==="StopTransaction"){txt+=` meterStop ${p.meterStop} Wh · reason ${p.reason||"Local"}`;meta.meterStop=p.meterStop;meta.stopReason=p.reason||"Local";if(p.transactionId!=null)meta.transactionId=p.transactionId}
        if(act==="RemoteStartTransaction")txt+=` idTag ${p.idTag||"–"}`;if(act==="RemoteStopTransaction")txt+=` transactionId ${p.transactionId}`;if(act==="DataTransfer")txt+=` ${p.vendorId||""} ${p.messageId||""} ${typeof p.data==="string"?p.data:JSON.stringify(p.data||"")}`;
        if(t!=null)ev.push({ts:t,src:"OCPP",msg:txt,err:(/Faulted|EmergencyStop|PowerLoss|OtherError|Error\b/i.test(txt)&&!/NoError/.test(txt))||act==="RemoteStopTransaction"})}}
    else if(typ===3&&ts!=null){const act=pend[fr[1]];if(act==="StartTransaction"&&fr[2]&&fr[2].transactionId!=null)meta.transactionId=fr[2].transactionId;if(act&&act!=="MeterValues"&&act!=="Heartbeat")ev.push({ts,src:"OCPP",msg:`${act}.conf ${JSON.stringify(fr[2]).slice(0,90)}`,err:/Rejected|Invalid|Blocked|Expired/i.test(JSON.stringify(fr[2]))})}
    else if(typ===4&&ts!=null)ev.push({ts,src:"OCPP",msg:`CALLERROR ${fr[2]} ${fr[3]||""}`,err:true})});
  return{samples:[...map.values()],events:ev,meta}}
function parseCSV(text){const lines=text.split(/\r?\n/).filter(l=>l.trim());const sep=(lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length?";":",";
  const hd=lines[0].split(sep).map(h=>h.trim().toLowerCase().replace(/^"|"$/g,""));const find=re=>hd.findIndex(h=>re.test(h));
  const col={time:find(/^(time|timestamp|date.?time|ts)/),vT:find(/target.*v(olt)?$|ev_target_v|targetvoltage/),vP:find(/^(output_v|voltage|v_out|evse.*present.*v|present_?v|volt)/),
   iReq:find(/request|ev_?target.*(_a|current)|targetcurrent/),iLim:find(/limit|offered|max.*current/),iP:find(/^(output_a|current(_a)?|i_out|evse.*present.*(_a|current)|present_?(a|current))$/),
   pw:find(/power|(^|_)kw/),soc:find(/soc/),energy:find(/energy|kwh|wh$/),gun:find(/temp|gun/),step:find(/^(step|state|phase|stage)/),cp:find(/^cp/),iso:find(/iso/),mods:find(/module/)};
  if(col.time<0)col.time=0;const map=new Map(),ev=[];let lastStep="";
  lines.slice(1).forEach(l=>{const c=l.split(sep).map(x=>x.trim().replace(/^"|"$/g,""));const ts=parseTs(c[col.time]);if(ts==null)return;const g=k=>col[k]>=0?num(c[col[k]]):null;
    mergeSample(map,ts,{vP:g("vP"),vT:g("vT"),iP:g("iP"),iReq:g("iReq"),iLim:g("iLim"),pw:g("pw"),soc:g("soc"),energy:g("energy"),gun:g("gun"),iso:g("iso"),mods:g("mods")});
    const st=col.step>=0?c[col.step]:"";if(st&&st!==lastStep){ev.push({ts,src:"STEP",msg:`Step: ${st}${col.cp>=0?" · CP "+c[col.cp]:""}`,err:/fail|error|timeout|fault/i.test(st)});lastStep=st}});
  return{samples:[...map.values()],events:ev,meta:{columns:Object.entries(col).filter(([,v])=>v>=0).map(([k,v])=>`${k}←${hd[v]}`)}}}
function parseText(lines){const map=new Map(),ev=[],meta={};
  const keys=[["vT",/EVTargetVoltage[\s:=]+(-?[\d.]+)/i],["iReq",/EVTargetCurrent[\s:=]+(-?[\d.]+)/i],["vP",/EVSEPresentVoltage[\s:=]+(-?[\d.]+)/i],["iP",/EVSEPresentCurrent[\s:=]+(-?[\d.]+)/i],["soc",/(?:EVRESSSOC|SOC)[\s:=]+([\d.]+)/i],["iLim",/EVSEMaximumCurrentLimit[\s:=]+([\d.]+)/i],["gun",/(?:gun|connector)\s*temp(?:erature)?[\s:=]+([\d.]+)/i],["pw",/power[\s:=]+([\d.]+)\s*kW/i]];
  lines.forEach(l=>{const m=l.match(/^\s*\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)\]?\s*(.*)$/);if(!m)return;const ts=parseTs(m[1]);if(ts==null)return;const rest=m[2];
    const o={};keys.forEach(([k,re])=>{const x=rest.match(re);if(x)o[k]=num(x[1])});if(Object.keys(o).length)mergeSample(map,ts,o);
    const src=(rest.match(/^(OCPP|CTRL|V2G|SLAC|PLC|SECC|EVSE|EV)\b/)||[])[1]||"LOG";const body=rest.replace(/^(OCPP|CTRL|V2G|SLAC|PLC|SECC|EVSE|EV)\s+/,"");
    if(!/^CurrentDemand/i.test(body)||/error|fail|stop/i.test(body))ev.push({ts,src,msg:body,err:/error|fail|timeout|fault|not received|not sent|deviation|abort|emergency|expired|did not/i.test(rest)})});
  return{samples:[...map.values()],events:ev,meta}}
function parseLog(text,name){text=text.replace(/^\uFEFF/,"");const lines=text.split(/\r?\n/).filter(l=>l.trim());let r,format;
  if(/\[\s*[234]\s*,\s*"/.test(text.slice(0,20000))){r=parseOCPP(lines);format="OCPP 1.6J message log"}
  else if(lines.length>1&&/[,;]/.test(lines[0])&&!/^\s*\[?\d{1,4}[-:]/.test(lines[0])&&/(^|[,;"\s])(time|timestamp|datetime|date_time|ts)([,;"\s]|$)/i.test(lines[0])){r=parseCSV(text);format="CSV time series"}
  else{r=parseText(lines);format="Controller / V2G text log"}
  const all=[...r.samples.map(s=>s.ts),...r.events.map(e=>e.ts)];if(!all.length)throw new Error("no timestamped lines found. Expected OCPP JSON frames, a CSV with a time column, or text lines that start with a time.");
  const t0=Math.min(...all);r.samples.forEach(s=>{s.t=(s.ts-t0)/1000;if(s.pw==null&&s.vP!=null&&s.iP!=null)s.pw=s.vP*s.iP/1000});r.events.forEach(e=>e.t=(e.ts-t0)/1000);
  r.samples.sort((a,b)=>a.t-b.t);r.events.sort((a,b)=>a.t-b.t);
  ["soc","iLim","gun"].forEach(k=>{let last=null;r.samples.forEach(s=>{if(s[k]!=null)last=s[k];else if(last!=null)s[k]=last})});
  r.format=format;r.name=name;r.t0=t0;r.absolute=t0>1e11;r.T=Math.max(1,...r.samples.map(s=>s.t),...r.events.map(e=>e.t));
  r.anoms=detectAnomalies(r);r.stats=logStats(r);return r}
function logStats(r){const s=r.samples,chg=s.filter(x=>(x.iP||0)>2);const st={samples:s.length,events:r.events.length,durationS:r.T};
  const socs=s.filter(x=>x.soc!=null);if(socs.length){st.socStart=socs[0].soc;st.socEnd=socs[socs.length-1].soc}
  const en=s.filter(x=>x.energy!=null);if(en.length>1)st.kwh=+(en[en.length-1].energy-en[0].energy).toFixed(2);
  else if(chg.length>1){let e=0;for(let i=1;i<s.length;i++)e+=(s[i-1].pw||0)*(s[i].t-s[i-1].t)/3600;st.kwh=+e.toFixed(2)}
  if(chg.length){st.peakKw=+Math.max(...chg.map(x=>x.pw||0)).toFixed(1);st.peakA=Math.round(Math.max(...chg.map(x=>x.iP)));const dur=chg[chg.length-1].t-chg[0].t;st.avgKw=dur>0&&st.kwh!=null?+(st.kwh/(dur/3600)).toFixed(1):null;st.chargeS=dur}
  if(r.meta.meterStart!=null&&r.meta.meterStop!=null)st.meterKwh=+((r.meta.meterStop-r.meta.meterStart)/1000).toFixed(3);
  const cmp=chg.filter(x=>x.iReq!=null);if(cmp.length)st.chargerLimitedPct=Math.round(100*cmp.filter(x=>x.iReq>x.iP*1.1+2).length/cmp.length);
  return st}
function detectAnomalies(r){const A=[],s=r.samples;const add=(t,sev,kind,title,detail)=>A.push({t,sev,kind,title,detail});
  const med=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0};const dts=[];for(let i=1;i<s.length;i++)dts.push(s[i].t-s[i-1].t);const md=med(dts);
  for(let i=1;i<s.length;i++){const a=s[i-1],b=s[i];
    if(a.vP!=null&&b.vP!=null&&(a.iP||0)>5&&a.vP-b.vP>=12&&a.vP-b.vP<=90&&b.vP>100&&b.t-a.t<=Math.max(3,md*1.5))add(b.t,"high","volt_dip",`Voltage dropped ${Math.round(a.vP-b.vP)} V in ${(b.t-a.t).toFixed(1)} s`,`From ${a.vP.toFixed(1)} V to ${b.vP.toFixed(1)} V while ${Math.round(a.iP)} A was flowing.`);
    if((a.iP||0)>20&&((b.iP??99)<2||((b.iP??99)<0.35*a.iP&&(s[i+1]?.iP??99)<2))&&(b.soc==null||b.soc<95)&&!A.some(q=>q.kind==="abrupt_stop"&&Math.abs(q.t-b.t)<5))add(b.t,"high","abrupt_stop",`Current fell from ${Math.round(a.iP)} A to zero`,b.soc!=null?`SOC was only ${b.soc}%, so the battery was not full.`:`No SOC in the log to tell whether the battery was full.`);
    if(md>0&&b.t-a.t>Math.max(10*md,30)&&(a.iP||0)>2)add(a.t,"low","gap",`No data for ${Math.round(b.t-a.t)} s`,`Samples normally arrive every ${md.toFixed(1)} s; the log may be incomplete here.`);
    if(a.iLim!=null&&b.iLim!=null&&a.iLim>0&&b.iLim>0&&Math.abs(b.iLim-a.iLim)/a.iLim>0.25&&(a.iP||0)>5&&(b.iP||0)>5)add(b.t,"medium","limit_step",`Charger current limit changed ${Math.round(a.iLim)} → ${Math.round(b.iLim)} A`,`Typical when the sibling head starts or stops (power sharing) or the charger derates.`)}
  const chg=s.filter(x=>(x.iP||0)>5);
  const lim=chg.filter(x=>x.iReq!=null&&x.iReq>x.iP*1.15+3);if(chg.length>5&&lim.length/chg.length>0.3){const avg=lim.reduce((a,x)=>a+x.iP/x.iReq,0)/lim.length;add(lim[0].t,"medium","charger_limited",`Charger delivered less current than the car asked for during ${Math.round(100*lim.length/chg.length)}% of charging`,`On average ${Math.round(avg*100)}% of the request${lim[0].iLim!=null?`; charger limit around ${Math.round(med(lim.map(x=>x.iLim)))} A`:""}.`)}
  const hot=chg.filter(x=>x.gun!=null&&x.gun>=60);if(hot.length)add(hot[0].t,"medium","hot",`Connector temperature reached ${Math.round(Math.max(...hot.map(x=>x.gun)))} °C`,`Above about 60 °C most chargers derate current to protect the gun.`);
  const en=s.filter(x=>x.energy!=null&&(x.pw||0)>3);if(en.length>3&&en[en.length-1].energy-en[0].energy<0.01)add(en[0].t,"high","meter_stuck","Energy register did not increase while power flowed",`${Math.round(Math.max(...en.map(x=>x.pw)))} kW was measured but Energy.Active.Import.Register stayed at ${en[0].energy} kWh.`);
  if(r.meta.meterStart!=null&&r.meta.meterStop!=null&&r.meta.meterStop-r.meta.meterStart<=0&&chg.length)add(r.T,"high","meter_zero","meterStop equals meterStart although current flowed","The transaction will be billed 0 kWh.");
  let flat=null;for(const x of chg){if(x.soc==null)continue;if(!flat||x.soc!==flat.soc)flat={soc:x.soc,t:x.t};else if(x.t-flat.t>300&&x.iP>30){add(flat.t,"low","soc_flat",`SOC stayed at ${x.soc}% for ${Math.round((x.t-flat.t)/60)} min while charging`,`Either the car is not reporting SOC updates or energy is not reaching the battery.`);break}}
  {const sl=r.events.filter(e=>/SLAC.*(timeout|not received)/i.test(e.msg));if(sl.length>=2){const cars=[...new Set(r.events.filter(e=>/Plug-in detected · /.test(e.msg)).map(e=>e.msg.split(" · ")[1]))];add(sl[0].t,"high","repeated_slac",`SLAC failed ${sl.length} times`,`${cars.length>1?`With ${cars.length} different cars (${cars.slice(0,4).join(", ")}). `:""}Between ${Math.round(sl[0].t/60)} and ${Math.round(sl[sl.length-1].t/60)} min into the log.`)}}
  r.events.filter(e=>e.err).slice(0,6).forEach(e=>add(e.t,/timeout|Faulted|EmergencyStop|CALLERROR|deviation|FAILED/i.test(e.msg)?"high":"medium","event",e.msg.slice(0,90),`${e.src} message flagged as an error.`));
  if(r.meta.stopReason&&!/^(Local|EVDisconnected)$/i.test(r.meta.stopReason))add(r.T,"medium","stop_reason",`Transaction stopped with reason ${r.meta.stopReason}`,r.meta.stopReason==="Remote"?"A RemoteStopTransaction ended the session, usually from the CPO backend.":"Not a normal driver-initiated stop.");
  const seen=new Set();return A.filter(a=>{const k=a.kind+Math.round(a.t/5);if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>a.t-b.t).slice(0,14)}
const ANOM_EXPLAIN={repeated_slac:"The same step failing again and again with different cars points to the charger, typically a controller/PLC hang; a communication-stack reset usually clears it, and the vendor needs the traces for a permanent fix.",volt_dip:"A fast voltage step during charging is typical of power modules being reallocated (power sharing) or a DC-link contactor switching. Some cars, MG for example, stop when the deviation passes about 20 V. Usually the charger (EDS).",
 abrupt_stop:"Charging ended before the battery was full. Check what came just before: an EV error code points to the car, a RemoteStopTransaction to the CPO, a voltage step or fault to the charger.",
 charger_limited:"The car wanted more current than it got, so the charger was the bottleneck: power sharing with the other head, a fixed power split, an open DC link or thermal derating.",
 limit_step:"The charger changed the current it offers mid-session. If it coincides with the other head starting, the cause is power sharing.",
 hot:"High connector temperature makes the charger derate. Check cooling, gun contacts and cable wear.",meter_stuck:"Power flowed but the energy register did not move: a meter or OCPP reporting fault. Billing will be wrong. Charger software (EDS).",
 meter_zero:"Billing problem: the transaction reports zero energy. Rebuild energy from MeterValues and fix the meter read at StopTransaction.",soc_flat:"SOC not changing while current flows suggests the car stopped reporting SOC or the measured current is not reaching the battery.",
 gap:"Missing log data. The charger may have rebooted or the log buffer was overwritten; diagnosis around this point is uncertain.",event:"An error message from the log itself.",stop_reason:"The OCPP stop reason tells who ended the session."};
function exampleLog(kind){
  if(kind==="ocpp"){const S=sessions.filter(s=>s.dip).slice(-1)[0];const tr=buildTrace(S);const base=S.t;const iso=s=>new Date(base+s*1000).toISOString();const L=[];let id=100;const tx=parseInt(S.id.slice(-5));const send=(s,act,p)=>L.push(`${iso(s)} SEND [2,"${id++}","${act}",${JSON.stringify(p)}]`);
    send(0,"StatusNotification",{connectorId:S.h.n,errorCode:"NoError",status:"Preparing",timestamp:iso(0)});L.push(`${iso(12)} RECV [2,"cpo-77","RemoteStartTransaction",{"connectorId":${S.h.n},"idTag":"APP-4F21"}]`);
    send(tr.E,"StartTransaction",{connectorId:S.h.n,idTag:"APP-4F21",meterStart:1048210,timestamp:iso(tr.E)});L.push(`${iso(tr.E+0.4)} RECV [3,"${id-1}",{"transactionId":${tx},"idTagInfo":{"status":"Accepted"}}]`);
    let e=1048210,prev=tr.E;const arr=tr.smp.filter(x=>x.t>=tr.E);arr.forEach((x,i)=>{e+=x.pw*(x.t-prev)/3.6;prev=x.t;const near=tr.dipAt&&Math.abs(x.t-tr.dipAt)<1.5;if(i%5===0||near||i===arr.length-1)send(x.t,"MeterValues",{connectorId:S.h.n,transactionId:tx,meterValue:[{timestamp:iso(x.t),sampledValue:[{value:String(Math.round(e)),measurand:"Energy.Active.Import.Register",unit:"Wh"},{value:x.pw.toFixed(1),measurand:"Power.Active.Import",unit:"kW"},{value:x.iP.toFixed(1),measurand:"Current.Import",unit:"A"},{value:x.vP.toFixed(1),measurand:"Voltage",unit:"V"},{value:x.iLim.toFixed(0),measurand:"Current.Offered",unit:"A"},...(x.soc!=null?[{value:String(Math.round(x.soc)),measurand:"SoC",unit:"Percent"}]:[]),{value:x.gun.toFixed(0),measurand:"Temperature",unit:"Celsius"}]}]})});
    send(tr.Eend+1,"StatusNotification",{connectorId:S.h.n,errorCode:"OtherError",info:"EV stopped: FAILED_EVSEPresentVoltage",status:"Finishing",timestamp:iso(tr.Eend+1)});
    send(tr.Eend+2,"StopTransaction",{transactionId:tx,meterStop:Math.round(e),reason:"EVDisconnected",timestamp:iso(tr.Eend+2)});
    return{name:`ocpp_${S.h.id}_${S.id}.log`,text:L.join("\n")}}
  if(kind==="csv"){const S=sessions.filter(s=>s.lowKw).slice(-1)[0];const tr=buildTrace(S);const head="time,step,cp,ev_target_v,output_v,ev_request_a,output_a,charger_limit_a,power_kw,soc_pct,modules,gun_c,r_iso_kohm,limited_by";
    return{name:`export_${S.h.id}_${S.id}.csv`,text:[head,...tr.smp.map(x=>[new Date(S.t+x.t*1000).toISOString(),x.ph,x.cp,x.vT,x.vP,x.iReq,x.iP,x.iLim,x.pw,x.soc??"",x.mods,x.gun,x.iso??"",x.lim].join(","))].join("\n")}}
  const S=sessions.filter(s=>s.cause==="hang").slice(-1)[0];const ep=S.h.hangs.find(x=>S.t>=x.start&&S.t<=x.end);
  const list=S.h.sessions.filter(x=>x.t>=ep.start-40*60e3&&x.t<=S.t);const L=[];
  list.forEach(x=>{const tr=buildTrace(x);L.push(`${tsStr(x,0)} CTRL Plug-in detected · ${MODELS[x.m].n}`);replayLog(x,tr).forEach(l=>L.push(`${l.time} ${l.src} ${l.msg}`));
    if(x.out==="ok")tr.smp.filter((q,i)=>q.k==="energy"&&i%40===0).forEach(q=>L.push(`${tsStr(x,q.t)} V2G CurrentDemandRes EVSEPresentVoltage ${q.vP} EVSEPresentCurrent ${q.iP} EVTargetCurrent ${q.iReq} EVRESSSOC ${q.soc} EVSEMaximumCurrentLimit ${q.iLim}`))});
  L.sort();return{name:`controller_${S.h.id}_${fmtD(S.t).replace(" ","")}.txt`,text:L.join("\n")}}
function uploadBar(){return `<div class="card upbar"><div class="updrop" id="updrop"><input type="file" id="upfile" accept=".log,.txt,.csv,.json,.jsonl" hidden>
  <div><b>Analyse a log file</b><div class="muted" style="font-size:12.5px">OCPP 1.6J message logs (JSON frames), CSV time series, or controller / V2G text logs. The file is read in your browser.</div></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn pri" id="upPick">Upload log</button><span class="muted" style="font-size:12.5px">or drop it here · examples:</span><button class="chip sm" data-ex="ocpp">OCPP log</button><button class="chip sm" data-ex="csv">CSV export</button><button class="chip sm" data-ex="text">Controller log</button>
  ${upl&&replayMode!=="upload"?`<button class="btn sm" id="upShow">Open ${esc(upl.name)}</button>`:""}${replayMode==="upload"?`<button class="btn sm" id="upBack">Back to fleet sessions</button>`:""}</div></div>
  <div id="upErr" style="color:var(--bad);font-size:12.5px"></div></div>`}
function bindUploadBar(){const inp=$("#upfile"),drop=$("#updrop");if(!inp)return;
  const load=async f=>{if(f.size>15e6){$("#upErr").textContent="File is larger than 15 MB.";return}try{const txt=await f.text();setUpload(parseLog(txt,f.name))}catch(e){$("#upErr").textContent="Could not read this log: "+e.message}};
  $("#upPick").onclick=()=>inp.click();inp.onchange=()=>{if(inp.files[0])load(inp.files[0])};
  ["dragover","dragenter"].forEach(k=>drop.addEventListener(k,e=>{e.preventDefault();drop.classList.add("over")}));["dragleave","drop"].forEach(k=>drop.addEventListener(k,e=>{e.preventDefault();drop.classList.remove("over")}));
  drop.addEventListener("drop",e=>{const f=e.dataTransfer.files[0];if(f)load(f)});
  V.querySelectorAll("[data-ex]").forEach(b=>b.onclick=()=>{try{const x=exampleLog(b.dataset.ex);setUpload(parseLog(x.text,x.name))}catch(e){$("#upErr").textContent=e.message}});
  if($("#upShow"))$("#upShow").onclick=()=>{replayMode="upload";render();V.scrollTop=0};if($("#upBack"))$("#upBack").onclick=()=>{replayMode="fleet";render();V.scrollTop=0}}
function setUpload(r){if(uplAbort){uplAbort.abort();uplAbort=null}upl=r;upl.ai={text:"",src:"",busy:false};replayMode="upload";uplCursor=null;render();V.scrollTop=0;explainUpload()}
function viewUpload(){const r=upl,st=r.stats,W=900;const s=r.samples;const has=k=>s.some(x=>x[k]!=null);
  const x=t=>W*t/r.T;const PH=110,gap=24,top=14;const panels=[];if(has("vP")||has("vT"))panels.push("v");if(has("iP")||has("iReq")||has("iLim"))panels.push("i");if(has("pw")||has("soc"))panels.push("p");
  const Ht=top+panels.length*(PH+gap)+10;const vmax=Math.max(100,...s.map(q=>Math.max(q.vP||0,q.vT||0)))*1.08,imax=Math.max(20,...s.map(q=>Math.max(q.iP||0,q.iReq||0,q.iLim||0)))*1.08,pmax=Math.max(10,...s.map(q=>q.pw||0))*1.1;
  const y0=k=>top+k*(PH+gap);const yy=(k,v,mx)=>y0(k)+PH*(1-Math.max(0,Math.min(1,v/mx)));
  const line=(k,key,mx,col,dash="",w=2)=>{const pts=s.filter(q=>q[key]!=null).map(q=>`${x(q.t).toFixed(1)},${yy(k,q[key],mx).toFixed(1)}`).join(" ");return pts?`<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="${w}" ${dash?`stroke-dasharray="${dash}"`:""}/>`:""};
  let g="";panels.forEach((p,k)=>{for(let q=0;q<=4;q++)g+=`<line x1="0" x2="${W}" y1="${y0(k)+PH*q/4}" y2="${y0(k)+PH*q/4}" stroke="var(--scope-grid)"/>`;for(let q=0;q<=12;q++)g+=`<line y1="${y0(k)}" y2="${y0(k)+PH}" x1="${W*q/12}" x2="${W*q/12}" stroke="var(--scope-grid)"/>`;
    const lb=p==="v"?`Voltage · 0–${Math.round(vmax)} V`:p==="i"?`Current · 0–${Math.round(imax)} A`:`Power · 0–${Math.round(pmax)} kW${has("soc")?"   |   SOC · 0–100%":""}`;g+=`<text x="6" y="${y0(k)+12}" font-size="11" fill="#A9C2B9">${lb}</text>`;
    if(p==="v")g+=line(k,"vT",vmax,"var(--scope-v)","5 5",1.5)+line(k,"vP",vmax,"var(--scope-v)");if(p==="i")g+=line(k,"iLim",imax,"var(--scope-lim)","7 5",1.6)+line(k,"iReq",imax,"var(--scope-i)","4 4",1.5)+line(k,"iP",imax,"var(--scope-i)");if(p==="p")g+=line(k,"pw",pmax,"var(--scope-p)")+line(k,"soc",100,"var(--scope-soc)")});
  r.anoms.forEach((a,i)=>{const c=a.sev==="high"?"var(--scope-mark)":"var(--scope-lim)";g+=`<line x1="${x(a.t)}" x2="${x(a.t)}" y1="${top}" y2="${Ht-10}" stroke="${c}" stroke-width="1.5" ${a.sev==="high"?"":'stroke-dasharray="4 3"'}/><circle cx="${Math.min(W-9,Math.max(9,x(a.t)))}" cy="${top-4}" r="8" fill="${c}"/><text x="${Math.min(W-9,Math.max(9,x(a.t)))}" y="${top}" font-size="10" text-anchor="middle" fill="#10201C" font-weight="700">${i+1}</text>`});
  g+=`<line id="ucur" x1="0" x2="0" y1="${top}" y2="${Ht-10}" stroke="#FFFFFF" opacity="0"/><rect id="uhov" x="0" y="0" width="${W}" height="${Ht}" fill="transparent"/>`;
  const tfmt=t=>r.absolute?new Date(r.t0+t*1000).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Asia/Bangkok"}):(t<120?t.toFixed(1)+" s":(t/60).toFixed(1)+" min");
  const dur=st.durationS<120?Math.round(st.durationS)+" s":Math.round(st.durationS/60)+" min";
  V.innerHTML=vh("Session replay · uploaded log",`${esc(r.name)} · ${esc(r.format)} · ${st.samples} samples, ${st.events} messages over ${dur}${r.meta.transactionId!=null?` · transactionId ${esc(r.meta.transactionId)}`:""}`)+uploadBar()+
  `<div class="kpis">
   <div class="kpi"><div class="l">State of charge</div><div class="v">${st.socStart!=null?st.socStart+"% → "+st.socEnd+"%":"not in log"}</div></div>
   <div class="kpi"><div class="l">Energy</div><div class="v">${st.kwh!=null?st.kwh+" kWh":"–"}</div><div class="s">${st.meterKwh!=null?"meter start/stop: "+st.meterKwh+" kWh":"from samples"}</div></div>
   <div class="kpi"><div class="l">Peak / average power</div><div class="v">${st.peakKw!=null?st.peakKw+" / "+(st.avgKw??"–")+" kW":"–"}</div></div>
   <div class="kpi"><div class="l">Peak current</div><div class="v">${st.peakA!=null?st.peakA+" A":"–"}</div>${st.chargerLimitedPct!=null?`<div class="s">charger-limited ${st.chargerLimitedPct}% of the time</div>`:""}</div>
   <div class="kpi"><div class="l">Abnormal findings</div><div class="v" style="color:${r.anoms.some(a=>a.sev==="high")?"var(--bad)":r.anoms.length?"var(--warn)":"var(--ok)"}">${r.anoms.length}</div><div class="s">${r.anoms.filter(a=>a.sev==="high").length} high severity</div></div></div>
  <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(280px,1fr);align-items:start" id="upGrid">
   <div class="card"><h3>Signals from the log <small>${r.meta.columns?"columns read: "+esc(r.meta.columns.join(", ")):"time axis from first to last line"}</small></h3>
    ${s.length?`<div class="scopewrap"><div class="scopebox"><svg viewBox="0 0 ${W} ${Ht}" width="100%" role="img" aria-label="Signals from the uploaded log" id="uSvg">${g}</svg>
    <div class="legend" style="color:#9FB8AF">${has("vP")?`<span><i style="background:var(--scope-v)"></i>Voltage${has("vT")?" (dashed: EV target)":""}</span>`:""}${has("iP")?`<span><i style="background:var(--scope-i)"></i>Current${has("iReq")?" (dashed: EV request)":""}</span>`:""}${has("iLim")?`<span><i style="background:var(--scope-lim)"></i>Charger limit</span>`:""}${has("pw")?`<span><i style="background:var(--scope-p)"></i>Power</span>`:""}${has("soc")?`<span><i style="background:var(--scope-soc)"></i>SOC</span>`:""}<span><i style="background:var(--scope-mark);border-radius:50%"></i>Numbered: findings</span></div>
    <label style="display:flex;gap:10px;align-items:center;margin-top:8px;font-size:12.5px;color:#9FB8AF">Inspect a moment <input type="range" id="uR" min="0" max="${s.length-1}" value="${uplCursor??Math.round(s.length*0.5)}" style="flex:1"></label></div><div class="readout" id="uRo"></div></div>`:`<div class="empty">No numeric samples in this log. Messages and findings are still shown.</div>`}</div>
   <div class="card"><h3>Abnormal findings <small>rules engine · select one to jump</small></h3>${r.anoms.length?`<ol class="anoms">${r.anoms.map((a,i)=>`<li data-at="${a.t}" tabindex="0"><span class="anum ${a.sev}">${i+1}</span><div><b>${esc(a.title)}</b><div class="muted" style="font-size:12px">${tfmt(a.t)} · ${a.sev} severity</div><div style="font-size:13px">${esc(a.detail)}</div><div class="muted" style="font-size:12.5px;margin-top:2px">${esc(ANOM_EXPLAIN[a.kind]||"")}</div></div></li>`).join("")}</ol>`:`<div class="empty">Nothing abnormal found by the rules.</div>`}</div>
  </div>
  <div class="card" style="margin-top:14px"><h3>AI explanation <span style="display:flex;gap:8px"><button class="btn sm" id="aiRun">${upl.ai.text?"Explain again":"Explain with AI"}</button><button class="btn sm" id="aiStop" style="display:${upl.ai.busy?"":"none"}">Stop</button></span></h3>
   <div class="aitext" id="aiText" aria-live="polite">${upl.ai.text?esc(upl.ai.text):upl.ai.busy?"Reading the log…":"Press “Explain with AI” for a plain-language reading of this log."}</div><div class="muted" style="font-size:12px;margin-top:6px" id="aiSrc">${esc(upl.ai.src)}</div></div>
  <div class="card" style="margin-top:14px"><h3>Messages from the log <small>${r.events.length} lines${r.events.length>400?", first 400 shown":""}; errors in red</small></h3><div class="log mono" style="max-height:340px">${r.events.slice(0,400).map(e=>`<div class="${e.err?"er":""}">${esc(tfmt(e.t).padEnd(10," "))} ${esc(e.src.padEnd(5," "))} ${esc(e.msg)}</div>`).join("")||`<div class="muted">No message lines.</div>`}</div></div>`;
  if(window.innerWidth<1000)$("#upGrid").style.gridTemplateColumns="1fr";bindUploadBar();
  $("#aiRun").onclick=()=>explainUpload(true);$("#aiStop").onclick=()=>uplAbort&&uplAbort.abort();
  const jump=t=>{if(!s.length)return;let bi=0,bd=1e18;s.forEach((q,j)=>{const d=Math.abs(q.t-t);if(d<bd){bd=d;bi=j}});$("#uR").value=bi;$("#uR").dispatchEvent(new Event("input"))};
  if(s.length){const svg=$("#uSvg"),cur=$("#ucur"),ro=$("#uRo"),rg=$("#uR");const show=i=>{i=Math.max(0,Math.min(s.length-1,i));uplCursor=i;const q=s[i];cur.setAttribute("x1",x(q.t));cur.setAttribute("x2",x(q.t));cur.setAttribute("opacity",".8");rg.value=i;
      const row=(k,l,u,d=1)=>q[k]!=null?`<dt>${l}</dt><dd>${(+q[k]).toFixed(d)} ${u}</dd>`:"";ro.innerHTML=`<b>${tfmt(q.t)}</b><dl>${row("vP","Voltage","V")}${row("vT","EV target","V",0)}${row("iP","Current","A",0)}${row("iReq","EV request","A",0)}${row("iLim","Charger limit","A",0)}${row("pw","Power","kW")}${row("soc","SOC","%",0)}${row("energy","Energy","kWh",2)}${row("gun","Gun","°C",0)}</dl>`};
    $("#uhov").addEventListener("mousemove",e=>{const b=svg.getBoundingClientRect();jump((e.clientX-b.left)/b.width*r.T)});rg.oninput=e=>show(+e.target.value);show(+rg.value)}
  V.querySelectorAll(".anoms li").forEach(li=>{li.onclick=()=>jump(+li.dataset.at);li.onkeydown=e=>{if(e.key==="Enter")li.click()}})}
function uploadContext(){const r=upl,s=r.samples;const step=Math.max(1,Math.ceil(s.length/70));
  const pts=s.filter((q,i)=>i%step===0||r.anoms.some(a=>Math.abs(a.t-q.t)<2)).slice(0,110).map(q=>{const o={t:+q.t.toFixed(1)};["vP","vT","iP","iReq","iLim","pw","soc","energy","gun"].forEach(k=>{if(q[k]!=null)o[k]=+(+q[k]).toFixed(1)});return o});
  const evs=r.events.filter((e,i)=>e.err||i<40||r.anoms.some(a=>Math.abs(a.t-e.t)<10)).slice(0,90).map(e=>`${e.t.toFixed(1)}s ${e.src} ${e.msg}`);
  return{file:r.name,format:r.format,meta:r.meta,stats:r.stats,findingsByRules:r.anoms.map((a,i)=>({n:i+1,tSec:+a.t.toFixed(1),severity:a.sev,title:a.title,detail:a.detail})),fieldKey:"t=seconds from first line, vP=output voltage V, vT=EV target voltage V, iP=output current A, iReq=EV requested current A, iLim=charger current limit A, pw=power kW, soc=%, energy=kWh register, gun=connector temperature C",samples:pts,messages:evs}}
function localExplain(){const r=upl,st=r.stats;const hi=r.anoms.filter(a=>a.sev==="high");const kinds=new Set(r.anoms.map(a=>a.kind));
  let cause="No clear fault in this log",owner="–";
  if(kinds.has("volt_dip")&&(kinds.has("abrupt_stop")||r.events.some(e=>/FAILED_EVSEPresentVoltage|EV stop|ChargeProgress.?Stop/i.test(e.msg)))){cause="A power-sharing or DC-link voltage step made the car stop";owner="charger (EDS)"}
  else if(kinds.has("meter_zero")||kinds.has("meter_stuck")){cause="Meter or OCPP energy reporting fault";owner="charger software (EDS)"}
  else if(kinds.has("charger_limited")){cause="The charger limited power below what the car asked for";owner="charger (EDS) or its configuration"}
  else if(r.events.some(e=>/SLAC.*(timeout|not received)/i.test(e.msg))){cause="SLAC never completed: controller/PLC hang, or car communication";owner="charger (EDS) if it repeats with different cars"}
  else if(kinds.has("stop_reason")){cause="The session was stopped remotely";owner="CPO"}
  return `What happened:\n- ${r.format}, ${st.samples} samples${st.socStart!=null?`, SOC ${st.socStart}% → ${st.socEnd}%`:""}${st.kwh!=null?`, ${st.kwh} kWh`:""}${st.peakKw?`, peak ${st.peakKw} kW`:""}.\nAbnormal findings:\n${r.anoms.length?r.anoms.map((a,i)=>`${i+1}. ${a.title} at ${a.t.toFixed(0)} s. ${ANOM_EXPLAIN[a.kind]||""}`).join("\n"):"- None found by the rules."}\nLikely root cause: ${cause}. Owner: ${owner}.\nNext steps:\n- ${hi.length?"Compare with a good session on the same head and car model, and attach this log to the ticket.":"No action needed unless the customer reported a problem."}\nConfidence: ${hi.length?"medium":"low"}`}
async function explainUpload(force){if(!upl||upl.ai.busy)return;if(upl.ai.text&&!force)return;const a=upl.ai;a.busy=true;a.text="";a.src="";
  const setT=()=>{const el=$("#aiText");if(el)el.textContent=a.text||"Reading the log…";const st=$("#aiStop");if(st)st.style.display=a.busy?"":"none";const sr=$("#aiSrc");if(sr)sr.textContent=a.src;const rb=$("#aiRun");if(rb)rb.textContent=a.text&&!a.busy?"Explain again":"Explain with AI"};setT();
  const sample=await getSample();if(!sample){a.text=localExplain();a.src="Explained by the rules engine. The AI explanation runs when this page is opened in Claude.";a.busy=false;setT();return}
  const prompt=`You are an expert DC fast-charging diagnostics engineer (OCPP 1.6J, DIN 70121 / ISO 15118, power modules, DC link). Read this uploaded charging log, already parsed into JSON below, and explain it to an operations engineer. Plain text, no markdown headings or bold. Structure:
What happened: 2-3 lines describing the session in order (plug-in, start, charging profile, how it ended), citing times in seconds and values.
Abnormal findings: numbered list matching the rule findings where relevant (use their numbers) plus anything else you notice; for each, say what it means physically and whether it is most likely the charger, the car, the CPO backend or the site.
Likely root cause: one or two lines with the most probable cause and owner.
Next steps: 2-4 concrete checks or fixes.
Confidence: low/medium/high with a short reason. Be honest about what the log cannot show.
Under 260 words.

LOG:
${JSON.stringify(uploadContext())}`;
  uplAbort=new AbortController();
  try{const res=await sample([{role:"user",content:prompt}],{modelTier:"default",cache:false,signal:uplAbort.signal,onText:({text})=>{a.text=text;setT()}});a.text=res.text;a.src="Explained by Claude from the parsed log. Check the findings against the chart before acting."}
  catch(e){if(e&&e.code==="cancelled"){a.text=(e.text||a.text)+"\n(stopped)"}else{a.text=localExplain();a.src="Explained by the rules engine; Claude was unavailable ("+(e&&e.code||"error")+")."}}
  a.busy=false;uplAbort=null;setT()}

/* ============ funnel ============ */
let funnelBy="model";
function funnelOf(list){const n=list.length,by=stats(list).by;const s1=n-(by.slac||0),s2=s1-(by.auth||0),s3=s2-(by.contract||0),s4=s3-(by.pre||0),s5=s4-(by.drop||0);
  return[["Plugged in",n],["SLAC complete",s1],["Authorised",s2],["Contract accepted",s3],["PreCharge done",s4],["Normal stop",s5]]}
function groupKey(s){return funnelBy==="model"?MODELS[s.m].n:funnelBy==="cust"?custById[s.h.ch.cust].name:funnelBy==="fw"?"FW "+s.h.ch.fw:HW[s.h.ch.hw].name.split(" ·")[0]}
function viewFunnel(){
  const ss=scopeSessions();const f=funnelOf(ss);const n=f[0][1]||1;
  let worst=1;for(let i=1;i<f.length;i++){if(f[i-1][1]-f[i][1]>f[worst-1][1]-f[worst][1])worst=i}
  const groups={};ss.forEach(s=>{(groups[groupKey(s)]=groups[groupKey(s)]||[]).push(s)});
  const cols=[["slac","SLAC"],["auth","Authorisation"],["contract","ContractAuth"],["pre","PreCharge"],["drop","Drop mid-charge"]];
  const fleetRate={};const fb=stats(ss).by;let reach=ss.length;cols.forEach(([k])=>{fleetRate[k]=reach?(fb[k]||0)/reach:0;reach-=fb[k]||0});
  const rows=Object.entries(groups).filter(([,l])=>l.length>=40).map(([g,l])=>{const b=stats(l).by;let rc=l.length;const r={};cols.forEach(([k])=>{r[k]=rc?(b[k]||0)/rc:0;rc-=b[k]||0});return{g,n:l.length,r,ok:stats(l).rate}}).sort((a,b)=>a.ok-b.ok);
  let ins=[];const wk=cols[worst-1][0];
  ins.push(`The biggest loss is at <b>${esc(cols[worst-1][1])}</b>: ${(f[worst-1][1]-f[worst][1]).toLocaleString()} of ${n.toLocaleString()} plug-ins (${fmtPct((f[worst-1][1]-f[worst][1])/n)}).`);
  cols.forEach(([k,lab])=>{const top=rows.slice().sort((a,b)=>b.r[k]-a.r[k])[0];if(top&&top.r[k]>Math.max(0.03,fleetRate[k]*2.2))ins.push(`<b>${esc(top.g)}</b> loses ${fmtPct(top.r[k])} at ${esc(lab)}, against ${fmtPct(fleetRate[k])} for the scope.`)});
  const heat=(v,base)=>{const x=Math.min(1,v/Math.max(0.02,base*4));return `background:color-mix(in srgb, var(--bad) ${Math.round(x*55)}%, transparent)`};
  V.innerHTML=vh("Charging funnel",`${esc(scopeName())} · 30 days · where plug-ins are lost on the way to a normal stop`,
   `<div><label class="muted" for="fBy" style="font-size:12.5px">Compare by</label> <select id="fBy"><option value="model">Car model</option><option value="cust">Customer</option><option value="fw">Charger firmware</option><option value="hw">Charger hardware</option></select></div>`)+
  `<div class="grid g2"><div class="card"><h3>Funnel <small>share of plug-ins that reach each step</small></h3><div class="fun">${f.map((x,i)=>`<div class="row"><span>${esc(x[0])}</span><span style="background:var(--panel2);border-radius:4px"><span class="bar ${i===worst?"loss":""}" style="display:block;width:${(100*x[1]/n).toFixed(1)}%"></span></span><span class="n" style="text-align:right;font-variant-numeric:tabular-nums">${x[1].toLocaleString()} · ${fmtPct(x[1]/n)}</span></div>`).join("")}</div></div>
   <div class="card"><h3>What stands out</h3><ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:8px">${ins.map(x=>`<li>${x}</li>`).join("")}</ul><p class="muted" style="font-size:12.5px;margin:12px 0 0">Rates are per step: failures at a step ÷ sessions that reached it.</p></div></div>
  <div class="card" style="margin-top:14px"><h3>Loss at each step <small>groups with at least 40 sessions, worst first</small></h3><div class="scroll"><table class="tbl heat"><thead><tr><th>${funnelBy==="model"?"Car model":funnelBy==="cust"?"Customer":funnelBy==="fw"?"Firmware":"Hardware"}</th><th class="n">Sessions</th>${cols.map(c=>`<th class="n">${c[1]}</th>`).join("")}<th class="n">Success rate</th></tr></thead><tbody>
   ${rows.map(r=>`<tr><td>${esc(r.g)}</td><td class="n">${r.n.toLocaleString()}</td>${cols.map(([k])=>`<td class="c" style="${heat(r.r[k],fleetRate[k])}">${(r.r[k]*100).toFixed(1)}%</td>`).join("")}<td class="n">${fmtPct(r.ok)}</td></tr>`).join("")}
   <tr><td><b>Whole scope</b></td><td class="n">${ss.length.toLocaleString()}</td>${cols.map(([k])=>`<td class="c">${(fleetRate[k]*100).toFixed(1)}%</td>`).join("")}<td class="n">${fmtPct(stats(ss).rate)}</td></tr></tbody></table></div></div>`;
  $("#fBy").value=funnelBy;$("#fBy").onchange=e=>{funnelBy=e.target.value;render()};
}
/* ============ AI assistant ============ */
let chat=[],pendingQ=null,busy=false,abortCtl=null,samplePromise=null;
function getSample(){if(!samplePromise)samplePromise=(window.claude&&window.claude.use)?window.claude.use("sample").catch(()=>null):Promise.resolve(null);return samplePromise}
function findTarget(q){const ql=q.toLowerCase();let site=null;
  sites.forEach(s=>{const nm=s.name.toLowerCase();const short=nm.replace("phutthamonthon ","");if(ql.includes(nm)||ql.includes(short))if(!site||nm.length>site.name.length)site=s});
  const cm=ql.match(/\bc(?:harger)?\s?(\d{1,2})\b/),hm=ql.match(/\bh(?:ead)?\s?([12])\b/);
  const tx=q.match(/CHG\d{6}/i);if(tx){const S=sessions.find(x=>x.id===tx[0].toUpperCase());if(S)return{session:S,charger:S.h.ch,head:S.h}}
  if(site&&cm){const c=chargers.find(x=>x.site===site.id&&x.num===+cm[1]);if(c)return{charger:c,head:hm?c.heads[+hm[1]-1]:null,site}}
  return{site}}
function headBrief(h){const x=h.sessions.filter(s=>s.t>NOW-7*DAY);const st=stats(x);const causes={};x.forEach(s=>{if(s.out!=="ok"&&s.cause)causes[CAUSE[s.cause].t]=(causes[CAUSE[s.cause].t]||0)+1});
  return{head:hlabel(h),status:h.status,sessions7d:st.n,startSuccess7d:+(st.rate*100).toFixed(1),failuresByStep:Object.fromEntries(Object.entries(st.by).map(([k,v])=>[FAIL_STAGE[k],v])),causesByRules:causes,
   last10:h.sessions.slice(-10).map(s=>({time:fmtDT(s.t),car:MODELS[s.m].n,result:s.out==="ok"?"completed":"failed at "+FAIL_STAGE[s.out],ruleCause:s.cause?CAUSE[s.cause].t:null})),
   faultEpisodes:h.hangs.filter(e=>e.start<NOW).map(e=>({from:fmtDT(e.start),hours:+((Math.min(e.end,NOW)-e.start)/HOUR).toFixed(1),ongoing:!!e.ongoing}))}}
function buildContext(q){const tg=findTarget(q);const ss=scopeSessions();const st=stats(ss);const own=ownerCounts(ss);
  const top=scopeChargers().flatMap(c=>c.heads).map(h=>{const x=h.sessions.filter(s=>s.t>NOW-14*DAY);const s=stats(x);return{connector:hlabel(h),customer:custById[h.ch.cust].name,failures14d:s.fail,success14d:+(s.rate*100).toFixed(1),mainCause:topCause(x)}}).sort((a,b)=>b.failures14d-a.failures14d).slice(0,8);
  const byModel={};ss.forEach(s=>{const k=MODELS[s.m].n;(byModel[k]=byModel[k]||{n:0,fail:0,drop:0});byModel[k].n++;if(s.out!=="ok")byModel[k].fail++;if(s.out==="drop")byModel[k].drop++});
  const models=Object.entries(byModel).map(([k,v])=>({model:k,sessions:v.n,failPct:+(100*v.fail/v.n).toFixed(1),dropPct:+(100*v.drop/v.n).toFixed(1)})).sort((a,b)=>b.failPct-a.failPct).slice(0,8);
  const fw={};ss.forEach(s=>{const k=s.h.ch.fw;(fw[k]=fw[k]||{n:0,ps:0});fw[k].n++;if(s.cause==="ps")fw[k].ps++});
  const ctx={note:"Simulated fleet data for a prototype. Rule-engine causes are hints, not ground truth.",scope:scopeName(),window:"last 30 days",now:fmtDT(NOW),
   fleet:{chargers:scopeChargers().length,sessions:st.n,startSuccessPct:+(st.rate*100).toFixed(1),failuresByOwner:own},worstConnectors14d:top,carModels:models,
   firmware:Object.entries(fw).map(([k,v])=>({fw:k,sessions:v.n,powerSharingDropPct:+(100*v.ps/v.n).toFixed(2)})),
   openAlerts:alerts.filter(a=>!a.ack&&inScopeTarget(a.target)).slice(0,8).map(a=>({time:fmtDT(a.t),severity:a.sev,title:a.title,autoAction:a.action,result:a.result}))};
  if(tg.charger){const c=tg.charger;ctx.focus={charger:label(c),customer:custById[c.cust].name,hardware:HW[c.hw].name,firmware:c.fw,moduleTempsC:c.temps,dcLinkIssue:!!c.dclink,configDrift:!!c.configDrift,heads:(tg.head?[tg.head]:c.heads).map(headBrief)}}
  if(tg.session){const S=tg.session,tr=buildTrace(S);ctx.focusSession={id:S.id,connector:hlabel(S.h),car:MODELS[S.m].n,time:fmtDT(S.t),result:S.out==="ok"?"completed":"failed at "+FAIL_STAGE[S.out],ruleSummary:replaySummary(S,tr).txt,messages:replayLog(S,tr).map(l=>`${l.time} ${l.src} ${l.msg}`),performance:{socStartPct:tr.perf.socStart,socEndPct:tr.perf.socEnd,energyKwh:tr.perf.kwh,peakKw:tr.perf.peakKw,avgKw:tr.perf.avgKw,peakA:tr.perf.peakA,carMaxKw:MODELS[S.m].kw,chargerOfferedKw:Math.round(tr.perf.offerKw),limitedByCarPct:Math.round(tr.perf.carPct*100),limitedByChargerPct:Math.round(tr.perf.chgPct*100),chargerLimitReason:tr.perf.reason,gunMaxC:+tr.perf.gunMax.toFixed(0)},samples:tr.smp.filter((s,i)=>s.k==="energy"&&i%26===0||(tr.dipAt&&Math.abs(s.t-tr.dipAt)<1)).map(s=>({t:tsStr(S,s.t),socPct:s.soc,kw:s.pw,outA:s.iP,evRequestA:s.iReq,chargerLimitA:s.iLim,outV:s.vP}))}}
  if(tg.site&&!tg.charger){const cs=chargers.filter(c=>c.site===tg.site.id);const all=cs.flatMap(c=>c.heads.flatMap(h=>h.sessions));const td=all.filter(s=>bkkDay(s.t)===bkkDay(NOW));const fleetTd=sessions.filter(s=>bkkDay(s.t)===bkkDay(NOW));const cz={};td.filter(s=>s.out!=="ok").forEach(s=>{const k=CAUSE[s.cause||"unknown"].t;cz[k]=(cz[k]||0)+1});
    const hrs={};td.forEach(s=>{const k=fmtT(Math.floor((s.t+7*HOUR)/HOUR)*HOUR-7*HOUR);(hrs[k]=hrs[k]||[0,0]);hrs[k][1]++;if(s.out!=="ok")hrs[k][0]++});
    ctx.focusSite={site:tg.site.name,customer:custById[tg.site.cust].name,offlineNow:!!tg.site.offlineNow,chargers:cs.length,successRate30dPct:+(stats(all).rate*100).toFixed(1),today:{charges:td.length,successRatePct:+(stats(td).rate*100).toFixed(1),failuresByCause:cz,failedPerHour:Object.fromEntries(Object.entries(hrs).sort().map(([k,v])=>[k,`${v[0]}/${v[1]}`])),chargersWithFailures:new Set(td.filter(s=>s.out!=="ok").map(s=>s.h.ch.id)).size},fleetTodaySuccessRatePct:+(stats(fleetTd).rate*100).toFixed(1),siteAlerts:alerts.filter(a=>a.target===tg.site.id).map(a=>a.title+" — "+a.detail)}}
  return{ctx,tg}}
function localAnswer(q,ctx,tg){
  if(tg.session){const S=tg.session;return `Likely cause: ${CAUSE[S.cause]?.t||"none, the session completed"}\nEvidence:\n- ${replaySummary(S,buildTrace(S)).txt}\nNext step:\n- Open the replay and attach it to the ticket.\nConfidence: ${S.cause==="unknown"?"low":"high"}`}
  if(tg.charger){const hs=tg.head?[tg.head]:tg.charger.heads;const b=hs.map(headBrief);const worst=b.sort((a,c)=>a.startSuccess7d-c.startSuccess7d)[0];const cause=Object.entries(worst.causesByRules).sort((a,c)=>c[1]-a[1])[0];
    const ep=worst.faultEpisodes.find(e=>e.ongoing);
    return `Likely cause: ${cause?cause[0]:"no clear fault in the last 7 days"}\nEvidence:\n- ${worst.head}: ${worst.startSuccess7d}% success rate over ${worst.sessions7d} sessions in 7 days.\n- Failures by step: ${Object.entries(worst.failuresByStep).map(([k,v])=>k+" "+v).join(", ")||"none"}.\n${ep?`- A fault episode has been ongoing since ${ep.from}.\n`:""}Next step:\n- ${cause&&cause[0].startsWith("Controller")?"Reset the communication stack when idle, then send the traces to the controller vendor.":cause&&cause[0].startsWith("Power")?"Move this charger to firmware 2.5.0, which matches voltage before switching modules.":"Open the latest failed session in replay and assign an engineer."}\nConfidence: ${cause?"medium":"low"}`}
  if(ctx.focusSite&&ctx.focusSite.today){const f=ctx.focusSite,tt=f.today;const top=Object.entries(tt.failuresByCause).sort((a,b)=>b[1]-a[1])[0];
    return `Likely cause: ${top?top[0]:"no clear cause"}\nEvidence:\n- ${f.site}: ${tt.successRatePct}% success rate today over ${tt.charges} charges, against ${f.fleetTodaySuccessRatePct}% for the fleet.\n- ${top?top[1]:0} of ${tt.charges-Math.round(tt.charges*tt.successRatePct/100)} failures are "${top?top[0]:"–"}", spread over ${tt.chargersWithFailures} chargers, so it is site-wide rather than one charger.\n${f.siteAlerts.length?"- Alert: "+f.siteAlerts[0].split(" — ")[0]+"\n":""}Next step:\n- Ask site IT to check the router and firewall towards the CPO; switch the site to RFID fallback meanwhile.\nConfidence: ${top&&top[0].startsWith("Site")?"high":"medium"}`}
  const t=ctx.worstConnectors14d.slice(0,3);
  return `Answer: start with the connectors that fail most.\nEvidence:\n${t.map(x=>`- ${x.connector} (${x.customer}): ${x.failures14d} failures in 14 days, mostly ${x.mainCause}.`).join("\n")}\n- Failures by owner: ${Object.entries(ctx.fleet.failuresByOwner).map(([k,v])=>k+" "+v).join(", ")}.\nNext step:\n- Fix EDS-side causes first: controller hangs and power sharing.\nConfidence: medium`}
function renderChat(){const box=$("#chatBox");if(!box)return;box.innerHTML=chat.map(m=>`<div class="msg ${m.r}">${esc(m.text)}${m.src?`<div class="muted" style="font-size:12px;margin-top:6px">${esc(m.src)}</div>`:""}</div>`).join("")||`<div class="empty">Ask about a connector, a charge ID, a car model or the whole fleet. Answers use the data on this console.</div>`;
  box.lastElementChild?.scrollIntoView({block:"nearest"})}
async function ask(q){if(busy||!q.trim())return;busy=true;chat.push({r:"u",text:q});const a={r:"a",text:"Thinking…",src:""};chat.push(a);renderChat();updComposer();
  const {ctx,tg}=buildContext(q);const sample=await getSample();
  if(!sample){a.text=localAnswer(q,ctx,tg);a.src="Answered by the rules engine. The live AI assistant runs when this page is opened in Claude.";busy=false;renderChat();updComposer();return}
  const prior=chat.slice(0,-2).slice(-6).map(m=>({role:m.r==="u"?"user":"assistant",content:m.text}));
  const prompt=`You are the reliability-engineering assistant inside EDS Charger Ops, a console for a fleet of DC fast chargers (CCS2, OCPP 1.6J, DIN 70121 / ISO 15118). Use ONLY the JSON data below; it is simulated prototype data. Reply in the language of the question. Plain text, no markdown headings or bold. Format:
Likely cause: one line (or "Answer:" for non-diagnostic questions)
Evidence: 2-4 lines starting with "- ", each citing numbers from the data
Next step: 1-3 lines starting with "- "
Confidence: low, medium or high, with a few words why
Under 170 words. If the data cannot answer, say which data is missing.

DATA:
${JSON.stringify(ctx)}

QUESTION: ${q}`;
  abortCtl=new AbortController();
  try{const res=await sample([...prior,{role:"user",content:prompt}],{modelTier:"default",cache:false,signal:abortCtl.signal,onText:({text})=>{a.text=text;renderChat()}});
    a.text=res.text;a.src="Answered by Claude from the data on this console."}
  catch(e){if(e&&e.code==="cancelled"){a.text=(e.text||a.text).replace(/^Thinking…$/,"")+"\n(stopped)";a.src=""}
    else{a.text=localAnswer(q,ctx,tg);a.src=e&&e.code==="not_granted"?"Answered by the rules engine because Claude was not allowed for this page.":"Answered by the rules engine; Claude was unavailable ("+(e&&e.code||"error")+")."}}
  busy=false;abortCtl=null;renderChat();updComposer()}
function updComposer(){const b=$("#sendBtn"),s=$("#stopBtn");if(b)b.disabled=busy;if(s)s.style.display=busy?"":"none"}
function viewAssistant(){
  const hh=hangHeads[0];const ps=sessions.filter(s=>s.cause==="ps").slice(-1)[0];
  const slow=sessions.filter(s=>s.out==="ok"&&MODELS[s.m].kw>100&&s.maxKw<MODELS[s.m].kw*0.6&&!s.lowKw).slice(-1)[0];
  const sugg=[`Why is ${siteById[hh.ch.site].name.replace("Phutthamonthon ","")} C${hh.ch.num} H1 failing right now?`,...(slow?[`The driver says charge ${slow.id} was slow. Was it the car or the charger?`]:[]),"Which five connectors should we fix first this week, and why?","Are MG cars failing more than other models? What is the cause?",ps?`Why did charge ${ps.id} fail?`:"What changed after firmware 2.5.0?",`Summarise this month for ${custById.sky.name} in four bullets for the customer.`];
  V.innerHTML=vh("AI assistant","Ask in plain language. Answers cite the sessions, alerts and stats on this console, so you can check them.")+
  `<div class="chat"><div class="chips">${sugg.map(s=>`<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
   <div id="chatBox" class="chat" aria-live="polite"></div>
   <div class="composer"><textarea id="q" placeholder="e.g. Why does Chumphon C1 deliver low power?" aria-label="Question"></textarea><button class="btn pri" id="sendBtn">Ask</button><button class="btn" id="stopBtn" style="display:none">Stop</button></div>
   <p class="muted" style="font-size:12.5px;margin:0">Scope: ${esc(scopeName())}. The assistant suggests; a person approves any action. Asking Claude uses your Claude account.</p></div>`;
  renderChat();updComposer();
  V.querySelectorAll("[data-q]").forEach(b=>b.onclick=()=>ask(b.dataset.q));
  $("#sendBtn").onclick=()=>{const q=$("#q").value;$("#q").value="";ask(q)};
  $("#q").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#sendBtn").click()}};
  $("#stopBtn").onclick=()=>abortCtl&&abortCtl.abort();
  if(pendingQ){const q=pendingQ;pendingQ=null;ask(q)}
}

/* ============ alerts ============ */
let alertFilter="open";
function viewAlerts(){
  const list=alerts.filter(a=>inScopeTarget(a.target)&&(alertFilter==="all"||!a.ack));
  const fired=r=>alerts.filter(a=>a.rule===r&&inScopeTarget(a.target));
  V.innerHTML=vh("Alerts and rules",`${esc(scopeName())} · every rule comes from a real incident · auto-actions run only when the connector is idle`)+
  `<div class="grid g2" style="align-items:start"><div class="card"><h3>Rules <small>${RULES.filter(r=>r.on).length} of ${RULES.length} on</small></h3>
   ${RULES.map(r=>{const f=fired(r.id);const fx=f.filter(a=>/Recovered|recovered|corrected/.test(a.result)).length;return `<div class="rule"><button class="toggle" aria-pressed="${r.on}" aria-label="${esc(r.name)}" data-r="${r.id}"></button><div><b>${esc(r.name)}</b><div class="muted" style="font-size:13px">When: ${esc(r.cond)}</div><div style="font-size:13px">Then: ${esc(r.act)}</div><div class="muted" style="font-size:12.5px;margin-top:3px">Learned from: ${esc(r.from)}</div></div><div style="text-align:right;font-size:12.5px;white-space:nowrap"><b style="font-size:18px">${f.length}</b><div class="muted">fired, 30 d</div>${fx?`<div style="color:var(--ok)">${fx} auto-fixed</div>`:""}</div></div>`}).join("")}</div>
  <div class="card"><h3>Alert feed <span class="chips"><button class="chip" data-af="open" style="${alertFilter==="open"?"border-color:var(--accent);font-weight:600":""}">Unacknowledged</button><button class="chip" data-af="all" style="${alertFilter==="all"?"border-color:var(--accent);font-weight:600":""}">All</button></span></h3>
   <div class="att">${list.slice(0,40).map(a=>`<div class="it ${a.sev==="Critical"?"":a.sev==="High"?"warn":"info"}"><div style="display:flex;justify-content:space-between;gap:8px">${sevTag(a.sev)}<span class="muted" style="font-size:12px">${fmtDT(a.t)}</span></div><b style="margin-top:4px">${esc(a.title)}</b><span class="muted" style="font-size:13px">${esc(a.detail)}</span><span style="font-size:13px">Auto-action: ${esc(a.action)} → <b style="display:inline;color:${/Recovered|recovered|corrected/.test(a.result)?"var(--ok)":"var(--warn)"}">${esc(a.result)}</b></span>
   <span style="display:flex;gap:12px;margin-top:4px">${a.session?`<button class="lnk" data-s="${a.session}">Replay session</button>`:""}${targetCharger(a.target)?`<button class="lnk" data-ch="${targetCharger(a.target).id}">Charger 360</button>`:""}${a.ack?"":`<button class="lnk" data-ack="${a.id}">Acknowledge</button>`}</span></div>`).join("")||`<div class="empty">No unacknowledged alerts in this scope.</div>`}</div></div></div>`;
  V.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{const r=RULES.find(x=>x.id===b.dataset.r);r.on=!r.on;render()});
  V.querySelectorAll("[data-af]").forEach(b=>b.onclick=()=>{alertFilter=b.dataset.af;render()});
  V.querySelectorAll("[data-ack]").forEach(b=>b.onclick=()=>{alerts.find(a=>a.id===b.dataset.ack).ack=true;navCounts();render()});
  V.querySelectorAll("[data-s]").forEach(b=>b.onclick=()=>go("replay",{session:b.dataset.s}));
  V.querySelectorAll("[data-ch]").forEach(b=>b.onclick=()=>go("charger",{charger:b.dataset.ch}));
}

/* ============ compatibility ============ */
const LAB={mg:["Fails","Stops at about 20 V swing on firmware 2.4.1; passes on 2.5.0"],jaecoo:["Not tested","Some lots never send ContractAuthenticationReq; needs a car firmware update via the importer"],lowStart:["Passes","Asks for low current for the first minutes; looks slow but is normal"],aion:["Passes","Mid-session drops seen in the field, cause not yet found"]};
function viewCompat(){
  const ss=scopeSessions();const rows=MODELS.map((mo,i)=>{const l=ss.filter(s=>s.m===i);const st=stats(l);const top=Object.entries(st.by).sort((a,b)=>b[1]-a[1])[0];
    const lab=mo.mg?LAB.mg:mo.jaecoo?LAB.jaecoo:mo.lowStart?LAB.lowStart:mo.aion?LAB.aion:["Passes",mo.kw<30?"Plug-in hybrid: low maximum power is normal":"No known issues"];
    return{mo,st,top,lab}}).sort((a,b)=>a.st.rate-b.st.rate);
  V.innerHTML=vh("EV compatibility",`${esc(scopeName())} · 30 days · car model identified from EVCCID and app profiles`)+
  `<div class="card"><div class="scroll"><table class="tbl"><thead><tr><th>Car model</th><th class="n">Sessions</th><th class="n">Success rate</th><th>Most common failure</th><th>Power-sharing lab test</th><th>Notes</th></tr></thead><tbody>
  ${rows.map(r=>`<tr><td><b>${esc(r.mo.n)}</b><div class="muted" style="font-size:12px">max ${r.mo.kw} kW</div></td><td class="n">${r.st.n.toLocaleString()}</td><td class="n"><span class="tag ${r.st.rate<0.85?"t-bad":r.st.rate<0.9?"t-warn":"t-ok"}">${fmtPct(r.st.rate)}</span></td><td>${r.top?esc(FAIL_STAGE[r.top[0]])+` <span class="muted">(${r.top[1]})</span>`:"–"}</td><td><span class="tag ${r.lab[0]==="Fails"?"t-bad":r.lab[0]==="Passes"?"t-ok":"t-off"}">${esc(r.lab[0])}</span></td><td class="muted" style="font-size:13px;max-width:360px">${esc(r.lab[1])}</td></tr>`).join("")}</tbody></table></div>
  <p class="muted" style="font-size:12.5px;margin:10px 0 0">Success rate below 85% is marked as poor, 85–90% as watch. Lab tests switch modules on the sibling head while this car charges and measure the voltage swing the car accepts.</p></div>`;
}

/* ============ tickets ============ */
const TCOLS=["New","Investigating","Waiting partner","Closed"];
function ticketTarget(t){const c=targetCharger(t.target);return c?label(c):siteById[t.target]?siteById[t.target].name:"Fleet"}
function viewTickets(){
  const list=tickets.filter(t=>inScopeTarget(t.target));
  V.innerHTML=vh("Tickets",`${esc(scopeName())} · every incident has an owner, evidence and a 24-hour root-cause deadline`,`<button class="btn pri" id="newT">Log a report from LINE</button>`)+
  `<div class="kanban">${TCOLS.map(col=>{const ts=list.filter(t=>t.status===col);return `<div class="col"><h4>${col}<span class="muted">${ts.length}</span></h4>${ts.slice(0,col==="Closed"?8:40).map(t=>{const left=(t.sla-NOW)/HOUR;return `<div class="tk" data-t="${t.id}" role="button" tabindex="0"><span class="id">${t.id} · ${esc(t.source)}${t.model?" · "+esc(t.model):""}</span><b style="font-weight:600;font-size:13.5px">${esc(t.title)}</b>${col==="Closed"?`<span class="muted" style="font-size:12.5px">${esc(t.rca||"Resolved")}</span>`:t.rca?`<span class="tag t-info" style="align-self:flex-start">Root cause found, fix pending</span>`:`<span class="tag ${left<0?"t-bad":left<6?"t-warn":"t-ok"}" style="align-self:flex-start">${left<0?`RCA overdue by ${Math.round(-left)} h`:`RCA due in ${Math.round(left)} h`}</span>`}</div>`}).join("")||`<div class="muted" style="font-size:13px;padding:6px">None</div>`}</div>`}).join("")}</div>`;
  $("#newT").onclick=newTicketForm;
  V.querySelectorAll("[data-t]").forEach(b=>{b.onclick=()=>openTicket(b.dataset.t);b.onkeydown=e=>{if(e.key==="Enter")b.click()}});
}
function closeDrawer(){$("#drawer").classList.remove("open");$("#drawer").innerHTML=""}
function openTicket(id){const t=tickets.find(x=>x.id===id);const a=alerts.find(x=>x.id===t.alert);const D=$("#drawer");
  D.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px"><h2 id="drawerTitle" style="margin:0;font-size:18px">${t.id}</h2><button class="btn" id="dClose">Close</button></div>
  <p style="font-weight:600;margin:10px 0 4px">${esc(t.title)}</p><p class="muted" style="margin:0 0 12px">${esc(ticketTarget(t))} · opened ${fmtDT(t.created)} from ${esc(t.source)}</p>
  <table class="tbl"><tbody><tr><td class="muted">Status</td><td>${esc(t.status)}</td></tr><tr><td class="muted">Likely cause</td><td>${t.cause&&CAUSE[t.cause]?esc(CAUSE[t.cause].t+" · owner "+CAUSE[t.cause].o):"To be found"}</td></tr><tr><td class="muted">RCA due</td><td>${fmtDT(t.sla)}</td></tr>${a?`<tr><td class="muted">From alert</td><td>${esc(a.title)}<div class="muted">${esc(a.action)} → ${esc(a.result)}</div></td></tr>`:""}</tbody></table>
  <label for="rca" style="display:block;margin:14px 0 6px;font-weight:600">Root cause and fix</label><textarea id="rca" rows="4" style="width:100%">${esc(t.rca||"")}</textarea>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${t.session?`<button class="btn" id="dRep">Replay session</button>`:""}${targetCharger(t.target)?`<button class="btn" id="dCh">Charger 360</button>`:""}</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">${TCOLS.filter(c=>c!==t.status).map(c=>`<button class="btn ${c==="Closed"?"pri":""}" data-mv="${c}">Move to ${c}</button>`).join("")}</div>`;
  D.classList.add("open");$("#dClose").focus();
  $("#dClose").onclick=closeDrawer;
  D.querySelectorAll("[data-mv]").forEach(b=>b.onclick=()=>{t.rca=$("#rca").value;t.status=b.dataset.mv;closeDrawer();navCounts();render()});
  if($("#dRep"))$("#dRep").onclick=()=>{closeDrawer();go("replay",{session:t.session})};
  if($("#dCh"))$("#dCh").onclick=()=>{closeDrawer();go("charger",{charger:targetCharger(t.target).id})};}
function newTicketForm(){const D=$("#drawer");const cs=scopeChargers();
  D.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px"><h2 id="drawerTitle" style="margin:0;font-size:18px">Log a report from LINE</h2><button class="btn" id="dClose">Cancel</button></div>
  <p class="muted">What the LINE OA bot asks station staff, so every ticket starts with the facts engineers need.</p>
  <div style="display:grid;gap:10px">
   <label>Charger <select id="nC" style="width:100%">${cs.map(c=>`<option value="${c.id}">${esc(label(c))}</option>`).join("")}</select></label>
   <label>Head <select id="nH" style="width:100%"><option value="1">Head 1</option><option value="2">Head 2</option></select></label>
   <label>Car model <select id="nM" style="width:100%">${MODELS.map(m=>`<option>${esc(m.n)}</option>`).join("")}<option>Not known</option></select></label>
   <label>Battery % when plugged in <input type="text" id="nS" inputmode="numeric" style="width:100%" placeholder="e.g. 25"></label>
   <label>What happened <textarea id="nD" rows="3" style="width:100%" placeholder="e.g. Plugged in, scanned the app, charging never started"></textarea></label></div>
  <div style="margin-top:14px;display:flex;gap:8px"><button class="btn pri" id="nSave">Create ticket</button></div>`;
  D.classList.add("open");$("#dClose").onclick=closeDrawer;
  $("#nSave").onclick=()=>{const c=byId[$("#nC").value];const h=c.heads[+$("#nH").value-1];const S=h.sessions.slice().reverse().find(s=>s.out!=="ok");
    const d=$("#nD").value.trim()||"Charging problem reported by station staff";
    addTicket({created:NOW,title:`${hlabel(h)}: ${d}`,target:c.id,session:S?S.id:null,cause:S?S.cause:null,status:"New",source:"LINE OA",model:$("#nM").value,rca:""});
    tickets.sort((a,b)=>b.created-a.created);closeDrawer();navCounts();render()}}
function onKey(e){if(!V)return;if(e.key==="Escape"&&$("#drawer").classList.contains("open"))closeDrawer();
  if(current==="replay"&&["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||"")){const b=$(e.key==="ArrowUp"||e.key==="ArrowRight"?"#newerS":"#olderS");if(b&&!b.disabled){e.preventDefault();b.click();const f=V.querySelector(".ri.sel .rc");if(f)f.focus({preventScroll:true})}}}

/* ============ releases ============ */
function viewReleases(){
  const cs=scopeChargers();const v={};cs.forEach(c=>v[c.fw]=(v[c.fw]||0)+1);
  const mgOn=fw=>{const l=sessions.filter(s=>s.h.ch.fw===fw&&MODELS[s.m].mg&&s.h.ch.hw!=="DC60"&&inScopeCharger(s.h.ch));const d=l.filter(s=>s.out==="drop").length;return{n:l.length,r:l.length?d/l.length:0}};
  const a=mgOn("2.4.1"),b=mgOn("2.5.0-rc2");
  const all=fw=>stats(sessions.filter(s=>s.h.ch.fw===fw&&inScopeCharger(s.h.ch)));const sa=all("2.4.1"),sb=all("2.5.0-rc2");
  const drift=cs.filter(c=>c.configDrift);
  V.innerHTML=vh("Firmware and configuration",`${esc(scopeName())} · release through gates, roll back on worse KPIs, catch settings that drift`)+
  `<div class="grid g2"><div class="card"><h3>Versions in service <small>${cs.length} chargers</small></h3>${hbars(Object.entries(v).sort((x,y)=>y[1]-x[1]).map(([k,n])=>({l:"FW "+k,v:n,c:k.includes("rc")?"var(--info)":k==="2.3.7"?"var(--warn)":"var(--accent)"})),{lw:120})}
   <p class="muted" style="font-size:12.5px;margin:10px 0 0">2.3.7 is two releases behind and should move to 2.4.1 or later.</p></div>
   <div class="card"><h3>Is 2.5.0-rc2 better? <small>canary vs current, same period</small></h3><table class="tbl"><thead><tr><th>Measure</th><th class="n">2.4.1</th><th class="n">2.5.0-rc2</th></tr></thead><tbody>
    <tr><td>Success rate, all cars</td><td class="n">${fmtPct(sa.rate)}</td><td class="n">${sb.n?fmtPct(sb.rate):"–"}</td></tr>
    <tr><td>MG mid-charge drops</td><td class="n">${fmtPct(a.r)} <span class="muted">of ${a.n}</span></td><td class="n">${b.n?fmtPct(b.r):"–"} <span class="muted">${b.n?"of "+b.n:""}</span></td></tr>
    <tr><td>Sessions in sample</td><td class="n">${sa.n.toLocaleString()}</td><td class="n">${sb.n.toLocaleString()}</td></tr></tbody></table>
    <p style="margin:10px 0 0;font-size:13px">${b.n&&b.r<a.r?"The release candidate removes the MG power-sharing drops. Gate passed: promote to one full site.":"Not enough canary data yet in this scope."}</p></div></div>
  <div class="card" style="margin-top:14px"><h3>Rollout of 2.5.0 <small>each gate must pass before the next</small></h3><div class="steps">
   <div class="step done"><b>Lab test matrix</b><div class="muted" style="font-size:13px">7 car models × head-2 plug, stop, unplug × DC link idle and busy. Passed: under 10 V swing, no drops in 20 runs.</div></div>
   <div class="step done"><b>Canary</b><div class="muted" style="font-size:13px">${v["2.5.0-rc2"]||0} chargers across customers. Success rate held; MG drops gone.</div></div>
   <div class="step now"><b>One full site</b><div class="muted" style="font-size:13px">Next: a busy site for 48 h with automatic rollback if success rate falls by more than 2 points.</div></div>
   <div class="step"><b>Whole fleet</b><div class="muted" style="font-size:13px">In waves of 25 chargers, outside peak hours.</div></div></div></div>
  <div class="card" style="margin-top:14px"><h3>Configuration drift <small>checksums compared after every change</small></h3>
   ${drift.length?`<table class="tbl"><thead><tr><th>Charger</th><th>Setting</th><th>Baseline</th><th>Found</th><th></th></tr></thead><tbody>${drift.map(c=>`<tr><td>${esc(label(c))}</td><td>DC-link pairing</td><td class="mono">C${c.num===3?4:3} ↔ C${c.num}</td><td class="mono">none</td><td><button class="lnk" data-ch="${c.id}">Charger 360</button></td></tr>`).join("")}</tbody></table><p class="muted" style="font-size:12.5px;margin:10px 0 0">A flow update overwrote these settings. Restore from baseline, then add the setting to the update's protected list.</p>`:`<div class="empty">All chargers in this scope match their baseline.</div>`}</div>`;
  V.querySelectorAll("[data-ch]").forEach(b=>b.onclick=()=>go("charger",{charger:b.dataset.ch}));
}

/* ============ router & scope ============ */
const VIEWS={overview:["Overview",viewOverview],fleet:["Fleet monitor",viewFleet],charger:["Charger 360",viewCharger],replay:["Session replay",viewReplay],funnel:["Charging funnel",viewFunnel],assistant:["AI assistant",viewAssistant],alerts:["Alerts & rules",viewAlerts],compat:["EV compatibility",viewCompat],tickets:["Tickets",viewTickets],releases:["Firmware & config",viewReleases]};
let current="overview";
function syncScope(){const fc=$("#fCust"),fs=$("#fSite");
  fc.innerHTML=`<option value="all">All customers</option>`+CUSTOMERS.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("");fc.value=scope.cust;
  fs.innerHTML=`<option value="all">All sites</option>`+sites.filter(s=>scope.cust==="all"||s.cust===scope.cust).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join("");fs.value=scope.site}
function navCounts(){const a=alerts.filter(x=>!x.ack&&inScopeTarget(x.target)).length,t=tickets.filter(x=>x.status!=="Closed"&&x.sla<NOW&&!x.rca&&inScopeTarget(x.target)).length;window.dispatchEvent(new CustomEvent("ops-counts",{detail:{alerts:a,tickets:t}}))}
function render(){const v=VIEWS[current]?current:"overview";$("#title").textContent=VIEWS[v][0];
  navCounts();try{VIEWS[v][1]()}catch(e){console.error(e);V.innerHTML=`<div class="empty">This view could not be drawn: ${esc(e.message)}</div>`}}
function route(h){current=VIEWS[h]?h:"overview";closeDrawer();render();window.scrollTo(0,0)}

function mount(view,el){
  V=el.querySelector("#view");
  $("#fCust").onchange=e=>{scope.cust=e.target.value;scope.site="all";syncScope();render()};
  $("#fSite").onchange=e=>{scope.site=e.target.value;syncScope();render()};
  $("#clock").textContent="Simulated data \u00b7 as of "+fmtDT(NOW);
  document.addEventListener("keydown",onKey);
  syncScope();route(view);
}
function unmount(){document.removeEventListener("keydown",onKey);V=null}
function show(view){if(V)route(view)}
return {mount,unmount,show,VIEW_IDS:Object.keys(VIEWS)};
}

let _ops: OpsEngine | null = null;
let _nav: (view: string) => void = () => {};
export function getOps(navigate: (view: string) => void): OpsEngine {
  _nav = navigate;
  if (!_ops) _ops = createOps(v => _nav(v));
  return _ops;
}
