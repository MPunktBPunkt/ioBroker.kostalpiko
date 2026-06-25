(function(){
var allLogs=[],allNodes={},allData={},histRows=[],histStringCfg={enabled:false,strings:[]};
var liveStringCfg={enabled:false,strings:[]};
var liveInvSpecs={enabled:false};
var histLastCount=0,histStringCount=2;
var chartInstances={};

window.showTab=function(n){
  document.querySelectorAll('.tc').forEach(function(e){e.classList.remove('act')});
  document.querySelectorAll('nav button').forEach(function(e){e.classList.remove('act')});
  var t=document.getElementById('tab-'+n); if(t) t.classList.add('act');
  document.querySelectorAll('nav button').forEach(function(b){
    if(b.getAttribute('onclick')==="showTab('"+n+"')") b.classList.add('act');
  });
  if(n==='logs')    loadLogs();
  if(n==='system')  loadSystem();
  if(n==='nodes')   renderNodes();
  if(n==='history') loadHistory(true);
};

/* ── Chart.js Theme ── */
function initChartTheme(){
  if(typeof Chart==='undefined') return;
  Chart.defaults.color='#8b949e';
  Chart.defaults.borderColor='rgba(48,54,61,.8)';
  Chart.defaults.font.family="'Segoe UI',system-ui,sans-serif";
  Chart.defaults.font.size=11;
  Chart.defaults.plugins.legend.display=false;
  Chart.defaults.plugins.tooltip.backgroundColor='rgba(22,27,34,.95)';
  Chart.defaults.plugins.tooltip.borderColor='#30363d';
  Chart.defaults.plugins.tooltip.borderWidth=1;
  Chart.defaults.plugins.tooltip.titleColor='#e6edf3';
  Chart.defaults.plugins.tooltip.bodyColor='#8b949e';
  Chart.defaults.plugins.tooltip.padding=10;
  Chart.defaults.elements.point.radius=0;
  Chart.defaults.elements.point.hoverRadius=4;
  Chart.defaults.elements.line.borderWidth=2;
  Chart.defaults.elements.line.tension=0.25;
}

function destroyCharts(){
  Object.keys(chartInstances).forEach(function(k){
    if(chartInstances[k]){chartInstances[k].destroy();chartInstances[k]=null;}
  });
}

function tsOpt(mode){
  var isDay=mode==='day';
  return {
    type:'time',
    time:{
      unit:isDay?'hour':'day',
      displayFormats:{hour:'HH:mm',day:'dd.MM',week:'dd.MM',month:'MMM yy'},
      tooltipFormat:isDay?'dd.MM.yyyy HH:mm':'dd.MM.yyyy'
    },
    grid:{color:'rgba(48,54,61,.5)'},
    ticks:{maxTicksLimit:isDay?12:8,color:'#8b949e'}
  };
}

function valOpt(label,unit,color){
  return {
    display:true,
    position:'left',
    title:{display:!!label,text:label||'',color:'#8b949e',font:{size:10}},
    grid:{color:'rgba(48,54,61,.35)'},
    ticks:{
      color:color||'#8b949e',
      callback:function(v){return unit?v+unit:v;}
    }
  };
}

function makeChart(id,cfg){
  if(typeof Chart==='undefined') return null;
  var el=document.getElementById(id);
  if(!el) return null;
  if(chartInstances[id]){chartInstances[id].destroy();}
  chartInstances[id]=new Chart(el,cfg);
  return chartInstances[id];
}

function rowTs(r){return r.date?new Date(r.date).getTime():r.ts;}

function dcPower(r,n){
  var d=r['dc'+n];
  return d&&d.power?d.power:0;
}
function dcVolt(r,n){
  var d=r['dc'+n];
  return d&&d.voltage?d.voltage:0;
}
function dcCurr(r,n){
  var d=r['dc'+n];
  return d&&d.current?d.current:0;
}

/* ── Live-Daten ── */
window.loadData=function(){
  fetch(window.location.origin+'/api/data').then(function(r){return r.json()}).then(function(j){
    allData=j.data||{}; allNodes=j.nodes||{};
    liveStringCfg=j.stringAnalysis||{enabled:false,strings:[]};
    liveInvSpecs=j.inverterSpecs||{enabled:false};
    var on=allData.online===1;
    document.getElementById('sdot').className='sd'+(on?' on':'');
    document.getElementById('stxt').textContent=on?'Online':'Offline';
    if(allData._ts) document.getElementById('lUpd').textContent='Aktualisiert '+new Date(allData._ts).toLocaleTimeString('de-DE');
    var b=document.getElementById('sBadge'); b.textContent=allData.status||'--'; b.className='sb'+(on?' on':'');
    function s(id,k,dec){var v=allData[k];document.getElementById(id).textContent=v!=null?(dec!=null?Number(v).toFixed(dec):v):'--';}
    s('d-acp','ac.power'); s('d-etot','energy.total'); s('d-eday','energy.today');
    s('d-s1v','pv.string1.voltage',0); s('d-s1a','pv.string1.current',2);
    s('d-s2v','pv.string2.voltage'); s('d-s2a','pv.string2.current',2);
    s('d-s3v','pv.string3.voltage'); s('d-s3a','pv.string3.current',2);
    var has3=(allData['device.strings']===3);
    ['card-s3v','card-s3a'].forEach(function(id){
      var el=document.getElementById(id); if(el) el.style.display=has3?'':'none';
    });
    s('d-l1v','ac.l1.voltage'); s('d-l1p','ac.l1.power');
    s('d-l2v','ac.l2.voltage'); s('d-l2p','ac.l2.power');
    s('d-l3v','ac.l3.voltage'); s('d-l3p','ac.l3.power');
    s('d-a1','info.analog1',2); s('d-a2','info.analog2',2); s('d-a3','info.analog3',2); s('d-a4','info.analog4',2);
    document.getElementById('d-modem').textContent=allData['info.modemStatus']||'--';
    renderStringAnalysis();
    renderInvSpecsCard(liveInvSpecs);
    document.getElementById('d-portal').textContent=allData['info.lastPortalConnection']||'--';
    s('d-s0','info.s0Pulses');
    var mdl=document.getElementById('d-model');
    if(mdl) mdl.textContent=allData['device.model']||'PIKO';
  }).catch(function(){});
};

/* ── History Navigation ── */
var navViewMode='day';
var navOffset=0;

function navGetRange(){
  var now=new Date(); now.setHours(0,0,0,0);
  var from=new Date(now), to=new Date(now);
  if(navViewMode==='day'){
    from.setDate(from.getDate()+navOffset);
    to=new Date(from); to.setDate(to.getDate()+1);
  } else if(navViewMode==='week'){
    var dow=now.getDay(); var mon=dow===0?6:dow-1;
    from.setDate(now.getDate()-mon+navOffset*7);
    to=new Date(from); to.setDate(to.getDate()+7);
  } else {
    from.setDate(1); from.setMonth(from.getMonth()+navOffset);
    to=new Date(from); to.setMonth(to.getMonth()+1);
  }
  return {from:from,to:to};
}

function navLabel(range){
  var f=range.from, t=new Date(range.to); t.setDate(t.getDate()-1);
  if(navViewMode==='day') return f.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  if(navViewMode==='week') return f.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})+' – '+t.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  return f.toLocaleDateString('de-DE',{month:'long',year:'numeric'});
}

function navFilter(rows){
  var r=navGetRange();
  var fromMs=r.from.getTime(), toMs=r.to.getTime();
  return rows.filter(function(row){
    var ts=row.date?new Date(row.date).getTime():row.ts||0;
    return ts>=fromMs && ts<toMs;
  });
}

window.navMode=function(m){
  navViewMode=m; navOffset=0;
  ['day','week','month'].forEach(function(k){
    var b=document.getElementById('nb-'+k);
    if(b) b.className='nav-btn'+(m===k?' active':'');
  });
  renderNavView();
};

window.navShift=function(d){
  navOffset+=d;
  if(navOffset>0) navOffset=0;
  renderNavView();
};

function voltColor(voltage,cfg){
  if(!cfg||!voltage||cfg.mppMin==null) return 'var(--txt)';
  if(voltage>=cfg.mppMin&&voltage<=cfg.mppMax) return 'var(--grn)';
  if(voltage>=cfg.mppMin*0.93&&voltage<=cfg.mppMax*1.04) return 'var(--orn)';
  return 'var(--red)';
}

function voltStatus(voltage,cfg){
  if(!cfg||!voltage||cfg.mppMin==null) return {pct:0,label:'--',color:'var(--mut)'};
  var mid=(cfg.mppMin+cfg.mppMax)/2;
  var pct=Math.round(voltage/mid*100);
  var color=voltColor(voltage,cfg);
  var label=pct+'%';
  if(voltage>=cfg.mppMin&&voltage<=cfg.mppMax) label+=' im MPP-Korridor';
  else if(voltage<cfg.mppMin) label+=' unter Korridor';
  else label+=' über Korridor';
  return {pct:pct,label:label,color:color};
}

function invLimitWarnings(voltage,current,cfg){
  var w=[];
  if(!cfg||!voltage) return w;
  if(cfg.invDcMaxV&&voltage>cfg.invDcMaxV) w.push('U > Udcmax '+cfg.invDcMaxV+'V');
  if(cfg.invDcMinV&&current>0.1&&voltage<cfg.invDcMinV) w.push('U < Udcmin '+cfg.invDcMinV+'V');
  if(cfg.invMppMin&&current>0.5&&voltage<cfg.invMppMin) w.push('U < MPP-Min '+cfg.invMppMin+'V');
  if(cfg.invMppMax&&current>0.5&&voltage>cfg.invMppMax) w.push('U > MPP-Max '+cfg.invMppMax+'V');
  if(cfg.invDcMaxA&&current>cfg.invDcMaxA) w.push('I > Idmax '+cfg.invDcMaxA+'A');
  return w;
}

function renderStringCard(cfg,volts,currs,titlePrefix){
  if(!volts.length){
    return '<div class="vc"><div class="vl">'+titlePrefix+cfg.id+'</div><div style="color:var(--mut);font-size:12px;margin-top:4px">Keine Erzeugung im Zeitraum</div></div>';
  }
  var vMin=Math.min.apply(null,volts), vMax=Math.max.apply(null,volts);
  var vAvg=Math.round(volts.reduce(function(a,b){return a+b;},0)/volts.length);
  var vPerMod=(vAvg/cfg.modules).toFixed(1);
  var iMax=currs.length?Math.max.apply(null,currs):0;
  var invW=invLimitWarnings(vAvg,iMax,cfg);
  var ok=0;
  volts.forEach(function(v){if(v>=cfg.mppMin&&v<=cfg.mppMax) ok++;});
  var okPct=Math.round(ok/volts.length*100);
  var st=voltStatus(vAvg,cfg);
  var invLine='';
  if(cfg.invDcMaxA||cfg.invMppMin){
    invLine='<div style="font-size:10px;color:var(--mut);margin-top:2px">WR-Grenzen: U '+cfg.invDcMinV+'–'+cfg.invDcMaxV+'V · MPP '+cfg.invMppMin+'–'+cfg.invMppMax+'V · I<sub>max</sub> '+cfg.invDcMaxA+'A</div>';
  }
  var warnLine=invW.length?'<div style="font-size:10px;color:var(--red);margin-top:2px">⚠ '+invW.join(' · ')+'</div>':'';
  return '<div class="vc">'+
    '<div class="vl">'+titlePrefix+cfg.id+' ('+cfg.modules+' Module)</div>'+
    '<div style="font-size:13px;font-weight:700;margin:4px 0">'+
      '<span style="color:'+st.color+'">'+vMin+'–'+vMax+'</span> V '+
      '<span style="color:var(--mut);font-weight:400">(Ø '+vAvg+' · '+vPerMod+' V/Mod)</span></div>'+
    '<div style="font-size:11px;color:var(--mut)">MPP-Korridor: '+cfg.mppMin+'–'+cfg.mppMax+' V · '+okPct+'% im Bereich</div>'+
    '<div style="font-size:11px;color:var(--mut)">I<sub>max</sub>: '+iMax.toFixed(2)+' A · Nenn: '+cfg.expectedPower+' Wp · Soll-MPP: '+cfg.expectedMpp+' V</div>'+
    invLine+warnLine+
    '</div>';
}

function getStringCfg(id){
  if(!histStringCfg.enabled) return null;
  for(var i=0;i<histStringCfg.strings.length;i++){
    if(histStringCfg.strings[i].id===id) return histStringCfg.strings[i];
  }
  return null;
}

function calcPeriodStats(rows){
  if(!rows.length) return null;
  var sorted=rows.slice().sort(function(a,b){return rowTs(a)-rowTs(b);});
  var peak=sorted[0], peakW=0, peakTs=0;
  var prod=[], maxDc=0, energyStart=null, energyEnd=null;
  sorted.forEach(function(r){
    if(r.acTotalPower>peakW){peakW=r.acTotalPower;peak=r;peakTs=rowTs(r);}
    if(r.acTotalPower>=50) prod.push(r);
    var dcSum=dcPower(r,1)+dcPower(r,2)+dcPower(r,3);
    if(dcSum>maxDc) maxDc=dcSum;
    if(r.totalEnergy>0){
      if(energyStart===null) energyStart=r.totalEnergy;
      energyEnd=r.totalEnergy;
    }
  });
  var yieldKwh=0;
  if(energyStart!==null&&energyEnd!==null&&energyEnd>energyStart){
    yieldKwh=Math.round((energyEnd-energyStart)*100)/100;
  } else {
    yieldKwh=Math.round(sorted.reduce(function(s,r){return s+(r.acTotalPower||0)*0.25;},0))/1000;
  }
  var avgW=prod.length?Math.round(prod.reduce(function(s,r){return s+r.acTotalPower;},0)/prod.length):0;
  return {
    peakW:peakW,
    peakTime:peakTs?new Date(peakTs).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'--',
    yieldKwh:yieldKwh,
    avgW:avgW,
    maxDc:maxDc,
    points:sorted.length,
    energyEnd:energyEnd
  };
}

function renderKpis(stats){
  if(!stats){
    ['kpi-peak','kpi-yield','kpi-avg','kpi-dc','kpi-pts','kpi-energy'].forEach(function(id){
      var el=document.getElementById(id); if(el) el.textContent='--';
    });
    var pt=document.getElementById('kpi-peak-t'); if(pt) pt.textContent='--';
    return;
  }
  document.getElementById('kpi-peak').textContent=stats.peakW+' W';
  document.getElementById('kpi-peak-t').textContent='um '+stats.peakTime;
  document.getElementById('kpi-yield').textContent=stats.yieldKwh.toFixed(2);
  document.getElementById('kpi-avg').textContent=stats.avgW+' W';
  document.getElementById('kpi-dc').textContent=stats.maxDc+' W';
  document.getElementById('kpi-pts').textContent=stats.points;
  document.getElementById('kpi-energy').textContent=stats.energyEnd!=null?stats.energyEnd.toFixed(1):'--';
}

function dsLine(rows,fn,color,label,yAxis){
  return {
    label:label,
    data:rows.map(function(r){return {x:rowTs(r),y:fn(r)};}),
    borderColor:color,
    backgroundColor:color+'22',
    fill:false,
    yAxisID:yAxis||'y',
    spanGaps:true
  };
}

function renderCharts(filtered,range){
  if(typeof Chart==='undefined'){
    var hint=document.getElementById('cache-hint');
    if(hint){hint.style.display='';hint.textContent='Chart.js nicht geladen – CDN prüfen';}
    return;
  }
  var sorted=filtered.slice().sort(function(a,b){return rowTs(a)-rowTs(b);});
  var has3=histStringCount>=3;
  var titleEl=document.getElementById('chart-main-title');
  if(titleEl) titleEl.textContent='Leistung & Erzeugung – '+navLabel(range);

  var mainDs=[
    dsLine(sorted,function(r){return r.acTotalPower;},'#f6c90e','AC Gesamt','y'),
    dsLine(sorted,function(r){return dcPower(r,1)+dcPower(r,2)+dcPower(r,3);},'#3fb950','DC Summe','y')
  ];
  makeChart('chart-main',{
    type:'line',
    data:{datasets:mainDs},
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      scales:{x:tsOpt(navViewMode),y:valOpt('W','','#f6c90e')}
    }
  });

  makeChart('chart-phases',{
    type:'line',
    data:{datasets:[
      dsLine(sorted,function(r){return r.ac1.power;},'#e3b341','L1','y'),
      dsLine(sorted,function(r){return r.ac2.power;},'#58a6ff','L2','y'),
      dsLine(sorted,function(r){return r.ac3.power;},'#a371f7','L3','y')
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      scales:{x:tsOpt(navViewMode),y:valOpt('W','','#e3b341')}
    }
  });

  var dcDs=[
    dsLine(sorted,function(r){return dcPower(r,1);},'#3fb950','String 1','y'),
    dsLine(sorted,function(r){return dcPower(r,2);},'#58a6ff','String 2','y')
  ];
  if(has3) dcDs.push(dsLine(sorted,function(r){return dcPower(r,3);},'#a371f7','String 3','y'));
  makeChart('chart-dc-power',{
    type:'line',data:{datasets:dcDs},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      scales:{x:tsOpt(navViewMode),y:valOpt('W','','#3fb950')}}
  });

  var voltDs=[
    dsLine(sorted,function(r){return dcVolt(r,1);},'#3fb950','S1 U','y'),
    dsLine(sorted,function(r){return dcVolt(r,2);},'#58a6ff','S2 U','y')
  ];
  if(has3) voltDs.push(dsLine(sorted,function(r){return dcVolt(r,3);},'#a371f7','S3 U','y'));
  makeChart('chart-dc-voltage',{
    type:'line',data:{datasets:voltDs},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      scales:{x:tsOpt(navViewMode),y:valOpt('V','','#3fb950')}}
  });

  makeChart('chart-grid',{
    type:'line',
    data:{datasets:[
      dsLine(sorted,function(r){return r.ac1.voltage;},'#e3b341','L1 U','y'),
      dsLine(sorted,function(r){return r.frequency;},'#a371f7','Hz','y1')
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      scales:{
        x:tsOpt(navViewMode),
        y:valOpt('V','','#e3b341'),
        y1:{position:'right',title:{display:true,text:'Hz',color:'#a371f7'},grid:{drawOnChartArea:false},ticks:{color:'#a371f7'}}
      }
    }
  });

  var energyRows=sorted.filter(function(r){return r.totalEnergy>0;});
  makeChart('chart-energy',{
    type:'line',
    data:{datasets:[dsLine(energyRows,function(r){return r.totalEnergy;},'#58a6ff','Gesamt kWh','y')]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      scales:{x:tsOpt(navViewMode),y:valOpt('kWh','','#58a6ff')}}
  });
}

function renderInvSpecsCard(inv){
  var card=document.getElementById('inv-specs-card');
  if(!card) return;
  if(!inv||!inv.enabled){ card.style.display='none'; return; }
  card.style.display='';
  var g=inv.grid||{};
  document.getElementById('inv-specs-body').innerHTML=
    '<div class="grid g4">'+
    '<div class="vc"><div class="vl">Modell</div><div class="vv" style="font-size:16px">'+inv.modelName+'</div><div class="vu">Nenn '+inv.pacNom+' W</div></div>'+
    '<div class="vc"><div class="vl">DC Eingang</div><div class="vv" style="font-size:14px">'+inv.dcMinV+'–'+inv.dcMaxV+' V</div><div class="vu">MPP '+inv.mppMinActive+'–'+inv.mppMax+' V · I<sub>max</sub> '+inv.dcMaxA+' A/String</div></div>'+
    '<div class="vc"><div class="vl">AC Netz (DE)</div><div class="vv" style="font-size:14px">'+g.acMinV+'–'+g.acMaxV+' V</div><div class="vu">'+g.fMin+'–'+g.fMax+' Hz</div></div>'+
    '<div class="vc"><div class="vl">Nenn-DC</div><div class="vv" style="font-size:14px">'+inv.udcNom+' V</div><div class="vu">laut Kostal-Datenblatt</div></div>'+
    '</div>';
function renderHistStringAnalysis(filtered){
  var invCard=document.getElementById('inv-specs-card-h');
  var invBody=document.getElementById('inv-specs-body-h');
  if(invCard&&invBody&&histStringCfg.inverter&&histStringCfg.inverter.enabled){
    invCard.style.display='';
    var inv=histStringCfg.inverter, g=inv.grid||{};
    invBody.innerHTML=
      '<div class="grid g4">'+
      '<div class="vc"><div class="vl">Modell</div><div class="vv" style="font-size:16px">'+inv.modelName+'</div><div class="vu">Nenn '+inv.pacNom+' W</div></div>'+
      '<div class="vc"><div class="vl">DC Eingang</div><div class="vv" style="font-size:14px">'+inv.dcMinV+'–'+inv.dcMaxV+' V</div><div class="vu">MPP '+inv.mppMinActive+'–'+inv.mppMax+' V · I<sub>max</sub> '+inv.dcMaxA+' A/String</div></div>'+
      '<div class="vc"><div class="vl">AC Netz (DE)</div><div class="vv" style="font-size:14px">'+g.acMinV+'–'+g.acMaxV+' V</div><div class="vu">'+g.fMin+'–'+g.fMax+' Hz</div></div>'+
      '<div class="vc"><div class="vl">Nenn-DC</div><div class="vv" style="font-size:14px">'+inv.udcNom+' V</div><div class="vu">laut Kostal-Datenblatt</div></div>'+
      '</div>';
  } else if(invCard) invCard.style.display='none';
  var card=document.getElementById('hsa-card');
  var grid=document.getElementById('hsa-grid');
  if(!card||!grid||!histStringCfg.enabled){
    if(card) card.style.display='none';
    return;
  }
  card.style.display='';
  var prod=filtered.filter(function(r){return r.acTotalPower>=50;});
  grid.innerHTML=histStringCfg.strings.map(function(cfg){
    var key='dc'+cfg.id;
    var volts=prod.map(function(r){return r[key]&&r[key].voltage?r[key].voltage:0;}).filter(function(v){return v>0;});
    var currs=prod.map(function(r){return r[key]&&r[key].current?r[key].current:0;}).filter(function(v){return v>0;});
    return renderStringCard(cfg,volts,currs,'String ');
  }).join('');
}

function renderNavView(){
  var range=navGetRange();
  var lbl=document.getElementById('nav-label');
  if(lbl) lbl.textContent=navLabel(range);
  var nxt=document.getElementById('nav-next');
  if(nxt) nxt.disabled=(navOffset>=0);
  var filtered=navFilter(histRows);
  var stats=calcPeriodStats(filtered);
  renderKpis(stats);
  renderCharts(filtered,range);
  renderHistStringAnalysis(filtered);
  renderHistTable(filtered);
  toggleDc3Columns(histStringCount>=3);
}

function toggleDc3Columns(show){
  ['th-dc3-1','th-dc3-2','th-dc3-3'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.style.display=show?'':'none';
  });
}

var histLoadTimer=null;
window.loadHistory=function(keepNav){
  var li=document.getElementById('h-li');
  if(li&&(!keepNav||li.textContent==='--')) li.textContent='Lade…';
  fetch(window.location.origin+'/api/history').then(function(r){return r.json();}).then(function(j){
    if(j.loading && (!j.rows||j.rows.length===0)){
      if(li) li.textContent='Lade Historiendaten… (bitte warten)';
      if(!histLoadTimer) histLoadTimer=setTimeout(function(){histLoadTimer=null;loadHistory(true);},3000);
      return;
    }
    if(histLoadTimer){clearTimeout(histLoadTimer);histLoadTimer=null;}
    histStringCfg=j.stringAnalysis||{enabled:false,strings:[]};
    histStringCount=j.stringCount||2;
    var newCount=j.recordCount||0;
    var dataChanged=(newCount!==histLastCount);
    histLastCount=newCount;
    histRows=j.rows||[];
    document.getElementById('h-cnt').textContent=newCount||histRows.length;
    document.getElementById('h-ep').textContent=j.pikoEpoch?j.pikoEpoch.substring(0,10):'--';
    document.getElementById('h-li').textContent=j.lastImported?new Date(j.lastImported).toLocaleString('de-DE'):'noch kein Import';
    if(histRows.length){
      var f=histRows[histRows.length-1],l=histRows[0];
      document.getElementById('h-rng').textContent=(f.date||'').substring(0,10)+' – '+(l.date||'').substring(0,10);
    } else {
      document.getElementById('h-rng').textContent='Keine Daten';
    }
    var cacheHint=document.getElementById('cache-hint');
    if(cacheHint){
      if(j.loading&&histRows.length){
        cacheHint.style.display='';
        cacheHint.textContent='⏳ Aktualisiere vom PIKO… (Cache-Daten werden angezeigt)';
      } else {
        cacheHint.style.display='none';
      }
    }
    if(!keepNav){
      navOffset=0; navViewMode='day';
      ['day','week','month'].forEach(function(k){
        var b=document.getElementById('nb-'+k);
        if(b) b.className='nav-btn'+(k==='day'?' active':'');
      });
    }
    renderNavView();
    if(dataChanged&&keepNav){
      var msg=document.getElementById('histSyncMsg');
      if(msg) msg.textContent='✓ Neue Daten geladen ('+newCount+' Punkte)';
    }
  }).catch(function(){
    if(li) li.textContent='Fehler beim Laden';
  });
};

function cellStyle(voltage,cfg,active){
  if(!cfg||!active||!voltage) return '';
  return 'color:'+voltColor(voltage,cfg)+';font-weight:600';
}

function renderHistTable(rows){
  var tb=document.getElementById('hTb');
  var r=rows||histRows;
  var has3=histStringCount>=3;
  var cols=has3?22:19;
  if(!r.length){
    tb.innerHTML='<tr><td colspan="'+cols+'" style="color:var(--mut);text-align:center;padding:16px">Keine Daten für diesen Zeitraum</td></tr>'; return;
  }
  var rev=r.slice().sort(function(a,b){return rowTs(b)-rowTs(a);});
  tb.innerHTML=rev.map(function(row){
    var dt=row.date?new Date(row.date).toLocaleString('de-DE'):'--';
    var dim=row.acTotalPower===0?'style="color:var(--mut)"':'';
    var active=row.acTotalPower>=50;
    var c1=getStringCfg(1), c2=getStringCfg(2), c3=getStringCfg(3);
    var u1s=cellStyle(row.dc1.voltage,c1,active);
    var u2s=cellStyle(row.dc2.voltage,c2,active);
    var u3s=has3?cellStyle(row.dc3&&row.dc3.voltage,c3,active):'';
    var i1s=active&&c1&&row.dc1.current?'color:'+voltColor(row.dc1.voltage,c1)+';font-weight:600':'';
    var i2s=active&&c2&&row.dc2.current?'color:'+voltColor(row.dc2.voltage,c2)+';font-weight:600':'';
    var dc3=row.dc3||{voltage:0,current:0,power:0};
    var err=row.errorCode?('<span style="color:var(--red)">'+row.errorCode+'</span>'):'–';
    var rowHtml='<tr '+dim+'><td style="font-size:11px;white-space:nowrap">'+dt+'</td>'+
      '<td style="font-weight:600">'+row.acTotalPower+'</td>'+
      '<td style="'+u1s+'">'+row.dc1.voltage+'</td><td style="'+i1s+'">'+row.dc1.current.toFixed(3)+'</td><td>'+row.dc1.power+'</td>'+
      '<td style="'+u2s+'">'+row.dc2.voltage+'</td><td style="'+i2s+'">'+row.dc2.current.toFixed(3)+'</td><td>'+row.dc2.power+'</td>';
    if(has3){
      rowHtml+='<td style="'+u3s+'">'+dc3.voltage+'</td><td>'+dc3.current.toFixed(3)+'</td><td>'+dc3.power+'</td>';
    }
    rowHtml+='<td>'+row.ac1.voltage+'</td><td>'+row.ac1.power+'</td>'+
      '<td>'+row.ac2.voltage+'</td><td>'+row.ac2.power+'</td>'+
      '<td>'+row.ac3.voltage+'</td><td>'+row.ac3.power+'</td>'+
      '<td>'+row.frequency+'</td>'+
      '<td>'+(row.totalEnergy?row.totalEnergy.toFixed(1):'–')+'</td>'+
      '<td>'+row.acStatus+'</td><td>'+err+'</td></tr>';
    return rowHtml;
  }).join('');
}

function histMsg(text){
  var msg=document.getElementById('histSyncMsg')||document.getElementById('syncMsg');
  if(msg) msg.textContent=text;
}

window.triggerSync=function(){
  histMsg('⏳ Hole LogDaten.dat vom PIKO…');
  fetch(window.location.origin+'/api/trigger-history').then(function(){
    setTimeout(function(){loadHistory(true);},4000);
    setTimeout(function(){loadHistory(true);},10000);
    setTimeout(function(){histMsg('✓ PIKO-Abruf gestartet – Anzeige wird automatisch aktualisiert');},500);
    setTimeout(function(){histMsg('');},15000);
  }).catch(function(e){ histMsg('Fehler: '+e.message); });
};

window.confirmSyncAll=function(){
  if(!confirm('Sync-All: Alle Datenpunkte der letzten ~6 Monate werden an InfluxDB \u00fcbertragen.\n\nDas kann je nach Datenmenge einige Minuten dauern.\n\nFortfahren?')) return;
  histMsg('Vollsync gestartet \u2013 bitte warten, das kann einige Minuten dauern...');
  var btn=document.getElementById('btnSyncAll');
  if(btn){ btn.disabled=true; btn.textContent='\u23F3 L\u00e4uft...'; }
  fetch(window.location.origin+'/api/sync-all').then(function(){
    histMsg('Vollsync l\u00e4uft. Anzeige wird in ca. 30 s aktualisiert.');
    setTimeout(function(){
      loadHistory(true);
      if(btn){ btn.disabled=false; btn.textContent='\u2605 Sync-All (gesamte Historie)'; }
      histMsg('');
    }, 30000);
  }).catch(function(e){
    histMsg('Fehler: '+e.message);
    if(btn){ btn.disabled=false; btn.textContent='\u2605 Sync-All (gesamte Historie)'; }
  });
};

/* ── Nodes ── */
window.renderStringAnalysis=function(){
  var cfg=liveStringCfg.enabled?liveStringCfg:{enabled:false,strings:[]};
  var strings=['1','2','3'];
  var hasAny=false;
  strings.forEach(function(n){
    var scfg=null;
    for(var i=0;i<cfg.strings.length;i++){if(String(cfg.strings[i].id)===n) scfg=cfg.strings[i];}
    var av=allData['pv.string'+n+'.voltage'];
    var ai=allData['pv.string'+n+'.current'];
    var ep=allData['string'+n+'.expectedPower'];
    var box=document.getElementById('sa-'+n);
    if(!box) return;
    if(!scfg||!ep||!av){box.style.display='none';return;}
    hasAny=true;
    box.style.display='';
    var st=voltStatus(av,scfg);
    var vPerMod=scfg.modules?(av/scfg.modules).toFixed(1):'--';
    var pEst=av&&ai?Math.round(av*ai):'--';
    var invW=invLimitWarnings(av,ai||0,scfg);
    var invHint='';
    if(scfg.invDcMaxA){
      invHint='<div style="font-size:10px;color:var(--mut)">WR: U '+scfg.invDcMinV+'–'+scfg.invDcMaxV+'V · MPP ab '+scfg.invMppMin+'V · I<sub>max</sub> '+scfg.invDcMaxA+'A</div>';
    }
    var warnLine=invW.length?'<div style="font-size:10px;color:var(--red)">⚠ '+invW.join(' · ')+'</div>':'';
    box.innerHTML='<div class="vl">String '+n+' ('+scfg.modules+' Module)</div>'+
      '<div style="font-size:13px;font-weight:700;margin:3px 0">'+
        '<span style="color:'+st.color+'">'+(av||'--')+'</span>'+
        ' / <span style="color:var(--mut)">'+scfg.expectedMpp+'</span> V MPP</div>'+
      '<div style="font-size:10px;color:var(--mut)">'+vPerMod+' V/Mod · ~'+pEst+' W · Nenn '+ep+' Wp</div>'+
      '<div style="font-size:10px;color:var(--mut)">Korridor: '+scfg.mppMin+'–'+scfg.mppMax+' V (Vmpp-basiert)</div>'+
      invHint+warnLine;
  });
  var card=document.getElementById('sa-card');
  if(card) card.style.display=hasAny?'':'none';
};

window.renderNodes=function(){
  var tb=document.getElementById('nTb'), keys=Object.keys(allNodes).sort();
  if(!keys.length){tb.innerHTML='<tr><td colspan="5" style="color:var(--mut);text-align:center;padding:16px">Daten-Tab zuerst \u00f6ffnen</td></tr>';return;}
  tb.innerHTML=keys.map(function(k){
    var n=allNodes[k], v=allData[k];
    var bc=n.type==='number'?'bn':(n.type==='boolean'?'bb':'bs');
    return '<tr><td style="font-family:monospace;font-size:11px;color:var(--blu)">'+k+'</td>'+
      '<td>'+(n.name||'')+'</td>'+
      '<td><span class="badge '+bc+'">'+(n.type||'')+'</span></td>'+
      '<td style="font-weight:600">'+(v!=null?v:'<span style="color:var(--mut)">--</span>')+'</td>'+
      '<td style="color:var(--mut)">'+(n.unit||'')+'</td></tr>';
  }).join('');
};

/* ── Logs ── */
window.loadLogs=function(){
  fetch(window.location.origin+'/api/logs').then(function(r){return r.json()}).then(function(j){allLogs=j.logs||[];renderLogs()});
};
window.renderLogs=function(){
  var f=document.getElementById('lvlF').value, c=document.getElementById('lWrap');
  var rows=f?allLogs.filter(function(l){return l.level===f}):allLogs;
  c.innerHTML=rows.length?rows.map(function(l){
    return '<div class="le"><span class="lts">'+l.ts.replace('T',' ').substring(0,19)+'</span>'+
      '<span class="llv l'+l.level+'">'+l.level+'</span>'+
      '<span class="lm">'+l.message.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</span></div>';
  }).join(''):'<div style="color:var(--mut);padding:6px">Keine Eintr\u00e4ge</div>';
  if(document.getElementById('aScrl').checked) c.scrollTop=c.scrollHeight;
};

/* ── System ── */
window.loadSystem=function(){
  fetch(window.location.origin+'/api/status').then(function(r){return r.json()}).then(function(s){
    function row(k,v){return '<div class="sr"><span class="sk">'+k+'</span><span class="sv">'+v+'</span></div>';}
    document.getElementById('sysInfo').innerHTML=[
      row('Adapter', s.adapter),
      row('Version', 'v'+s.version),
      row('Ziel-IP', s.ip+':'+s.port),
      row('Poll-Intervall', s.interval+' s'),
      row('Status', s.online?'<span class="sb on">Online</span>':'<span class="sb">Offline</span>'),
    ].join('');
    document.getElementById('sysHist').innerHTML=[
      row('Sync aktiviert', s.historyEnable?'<span class="chip ck">ja</span>':'<span class="chip ce">nein (in Einstellungen aktivieren)</span>'),
      row('Sync-Intervall', s.historyEnable?s.syncInterval+' Minuten':'\u2013'),
      row('InfluxDB-Instanz', '<code>'+s.influxInst+'</code>'),
      row('PIKO Inbetriebnahme', s.pikoEpoch?s.pikoEpoch.substring(0,10):'noch nicht ermittelt'),
      row('Letzter Sync', s.lastImported?new Date(s.lastImported).toLocaleString('de-DE'):'noch kein Sync'),
    ].join('');
  });
};

/* ── Auto-Refresh ── */
function tick(){
  var a=document.querySelector('.tc.act');
  if(!a) return;
  if(a.id==='tab-daten')   loadData();
  if(a.id==='tab-logs')    loadLogs();
  if(a.id==='tab-history') loadHistory(true);
}
initChartTheme();
loadData(); loadLogs();
setInterval(tick,15000);
window.addEventListener('resize',function(){
  if(document.getElementById('tab-history')&&document.getElementById('tab-history').classList.contains('act')){
    renderNavView();
  }
});
})();
