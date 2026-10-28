/* Les Camemberts — liaison TV ↔ téléphones (QR code + relais MQTT).
   La TV reste maître de la partie : chaque téléphone s'identifie comme un joueur,
   reçoit une vue personnelle et envoie les mêmes actions que les boutons de l'écran.
   Tous les échanges passent par un relais en ligne : ça fonctionne en 4G/5G comme en Wi-Fi.
   Aucune règle du jeu n'est modifiée. */
(function(){
  if(typeof mqtt==='undefined'||typeof qrcode==='undefined'||!window.RELAY)return;
  const ROOM_KEY='camemberts-room',BROKER_KEY='camemberts-broker';
  const ALPHA='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode=()=>Array.from({length:4},()=>ALPHA[Math.floor(Math.random()*ALPHA.length)]).join('');
  let code;try{code=localStorage.getItem(ROOM_KEY)}catch(e){}
  if(!code||!/^[A-Z0-9]{4}$/.test(code))code=newCode();
  try{localStorage.setItem(ROOM_KEY,code)}catch(e){}
  let bi=0;try{bi=Math.max(0,Math.min(RELAY.brokers.length-1,+localStorage.getItem(BROKER_KEY)||0))}catch(e){}
  const T=RELAY.topic(code);
  let client=null,up=false;
  const phones=new Map();     // pid -> {seen}
  let lobby=[];               // salon avant partie : [{pid,name}]

  /* ---------- QR code ---------- */
  function qrSvg(text){const q=qrcode(0,'M');q.addData(text);q.make();return q.createSvgTag({cellSize:4,margin:0,scalable:true});}
  function joinUrl(){return new URL('manette.html?r='+code+'&b='+bi,location.href).href;}
  function showQr(){
    const svg=qrSvg(joinUrl());
    $('qrimg').innerHTML=svg;$('qrimg2').innerHTML=svg;
    const short=new URL('m',location.href).href.replace(/^https?:\/\//,'');
    $('qrcode').textContent=code;$('qrcode2').textContent='Code '+code;$('qrcode3').textContent=code;$('qrcode4').textContent=code;
    $('qrurl').textContent=short;$('qrurl2').textContent=short;
    $('qrbox').hidden=false;$('qrbtn').hidden=false;
  }

  /* ---------- connexion au relais ---------- */
  function start(i){
    bi=i;const tvMsg=on=>JSON.stringify({on,b:bi,ts:Date.now()});
    if(client){try{client.end(true)}catch(e){}}
    const c=mqtt.connect(RELAY.brokers[i],{clientId:'tv-'+code+'-'+Math.random().toString(36).slice(2,8),
      keepalive:10,reconnectPeriod:2000,connectTimeout:8000,clean:true,
      will:{topic:T+'/tv',payload:tvMsg(false),qos:1,retain:true}});
    client=c;let ok=false;
    c.on('connect',()=>{ok=true;up=true;
      try{localStorage.setItem(BROKER_KEY,String(i))}catch(e){}
      c.subscribe(T+'/up',{qos:0});
      c.publish(T+'/tv',tvMsg(true),{qos:1,retain:true});
      showQr();updTv();broadcast();});
    c.on('close',()=>{if(client===c){up=false;updTv();}});
    c.on('message',(topic,buf)=>{if(client!==c)return;let m;try{m=JSON.parse(buf.toString())}catch(e){return}onMsg(m);});
    /* relais injoignable : on passe au suivant */
    setTimeout(()=>{if(!ok&&client===c)start((i+1)%RELAY.brokers.length);},8000);
  }
  window.addEventListener('pagehide',()=>{try{client&&client.connected&&client.publish(T+'/tv',JSON.stringify({on:false,b:bi}),{qos:0,retain:true})}catch(e){}});

  /* un téléphone silencieux depuis 12 s est considéré parti */
  setInterval(()=>{const now=Date.now();let gone=false;
    phones.forEach((v,pid)=>{if(now-v.seen>12000){phones.delete(pid);gone=true;}});
    /* salon : on oublie un joueur déconnecté depuis plus de 45 s */
    if(!inGame()){const on=onlinePids(),before=lobby.length;
      lobby.forEach(l=>{if(on.has(l.pid))l.last=now;});
      lobby=lobby.filter(l=>on.has(l.pid)||now-(l.last||now)<45000);
      if(lobby.length!==before)gone=true;}
    if(gone)changed();},3000);

  /* ---------- qui est qui ---------- */
  const inGame=()=>!!(S&&!$('game').hidden);
  const devs=()=>{if(S&&!S.devices)S.devices={};return S?S.devices:{};};
  const onlinePids=()=>new Set(phones.keys());
  const meOf=pid=>{const d=devs()[pid];return typeof d==='number'?d:-1;};
  const online=k=>{const on=onlinePids(),d=devs();return Object.keys(d).some(p=>d[p]===k&&on.has(p));};
  const othersOnline=k=>S.players.some((_,j)=>j!==k&&online(j));
  /* droits (la télécommande TV peut toujours tout faire) :
     - lancer / choisir sa case : le joueur dont c'est le tour, ou n'importe qui s'il n'a pas de téléphone connecté
     - voir la réponse / juger / choisir la catégorie finale : les adversaires, ou n'importe qui s'ils n'ont pas de téléphone */
  const canPlay=pid=>{const me=meOf(pid);return me>=0&&(me===S.cur||!online(S.cur));};
  const canJudge=pid=>{const me=meOf(pid);return me>=0&&(me!==S.cur||!othersOnline(S.cur));};

  function changed(){updTv();if(!inGame())fillTv();else broadcast();}

  /* remplit l'écran de configuration de la TV avec les joueurs du salon */
  function fillTv(){
    if(!inGame()&&lobby.length){nPlayers=Math.max(2,Math.min(4,lobby.length));renderSetup();
      lobby.forEach((l,k)=>{const i=$('pn'+k);if(i)i.value=l.name});}
    updTv();broadcast();
  }
  /* associe les téléphones du salon aux joueurs, par prénom */
  function bindLobby(){if(!S)return;const d=devs();
    lobby.forEach(l=>{if(typeof d[l.pid]==='number')return;
      const k=S.players.findIndex((p,j)=>p.name===l.name&&!Object.values(d).includes(j));if(k>=0)d[l.pid]=k;});
    save();}

  /* ---------- affichage TV : qui est connecté ---------- */
  function updTv(){
    const on=onlinePids(),n=on.size;
    $('qrn').textContent=n;
    let txt;
    if(inGame()){const names=S.players.filter((_,k)=>online(k)).map(p=>p.name);
      txt=names.length?'📱 '+names.join(', '):(n?n+' téléphone'+(n>1?'s':'')+' connecté'+(n>1?'s':''):'aucun téléphone connecté');}
    else{const names=lobby.filter(l=>on.has(l.pid)).map(l=>l.name);
      txt=names.length?'📱 '+names.join(', '):(n?n+' téléphone'+(n>1?'s':'')+' connecté'+(n>1?'s':''):'aucun téléphone connecté');}
    $('qrcount').textContent=up?txt:'⏳ Connexion au serveur…';
    if(inGame())document.querySelectorAll('#scores .score').forEach((el,k)=>{
      let b=el.querySelector('.ph');if(!b){b=document.createElement('span');b.className='ph';b.textContent='📱';b.title='Téléphone connecté';el.appendChild(b);}
      b.hidden=!online(k);});
    if(!inGame())document.querySelectorAll('#names .name-row').forEach((row,k)=>{
      let b=row.querySelector('.ph');if(!b){b=document.createElement('span');b.className='ph';b.textContent='📱';row.appendChild(b);}
      const l=lobby[k];b.hidden=!(l&&on.has(l.pid));});
  }

  /* ---------- état envoyé à chaque téléphone ---------- */
  function view(pid){
    const on=onlinePids();
    if(!inGame()){let resume=null;
      try{if(saved){const st=JSON.parse(saved.state);if(st.phase!=='win')resume=st.players.map(p=>p.name);}}catch(e){}
      return{mode:'setup',resume,lobby:lobby.map(l=>({name:l.name,online:on.has(l.pid)})),me:lobby.findIndex(l=>l.pid===pid)};}
    const p=S.players[S.cur],me=meOf(pid);
    const v={mode:'game',phase:S.phase,cur:S.cur,me,msg:S.msg||'',roll:S.roll,rolling:!!rolling,
      canPlay:canPlay(pid),canJudge:canJudge(pid),
      players:S.players.map((q,k)=>({name:q.name,wedges:q.wedges,color:PCOL[k],online:online(k)&&k!==me})),
      cats:CATS.map(c=>({name:c.name,color:c.color,ink:c.ink})),
      options:S.phase==='choose'?S.options.map((i,j)=>{const l=label(i);return{i,c:l.c,t:l.t,dir:S.options.length>1?(j?'↺':'↻'):''}}):[]};
    if(S.phase==='question'&&S.q){const c=CATS[S.q.cat],[q,a]=Q[c.id][S.q.idx];
      v.q={cat:c.name,color:c.color,ink:c.ink,text:q,shown:!!S.q.shown,
        answer:S.q.shown&&me!==S.cur?a:null,tag:S.q.final?'Question finale':S.q.hq?'Case camembert':''};}
    if(S.phase==='win')v.winner=p.name;
    return v;
  }
  function pub(pid,m,retain){if(!client||!client.connected)return;try{client.publish(T+'/d/'+pid,JSON.stringify(m),{qos:0,retain:!!retain})}catch(e){}}
  function send(pid){pub(pid,{t:'state',v:view(pid)},true);}
  let pending=false;
  function broadcast(){if(pending)return;pending=true;
    Promise.resolve().then(()=>{pending=false;phones.forEach((_,pid)=>send(pid));});}

  /* ---------- messages reçus ---------- */
  function click(id){const el=$(id);if(el&&!el.hidden&&!el.disabled)el.click();}
  function onMsg(m){
    if(!m||typeof m!=='object')return;
    const pid=String(m.p||'').slice(0,40);if(!pid)return;
    const known=phones.has(pid);phones.set(pid,{seen:Date.now()});
    if(m.t==='ping'){if(known)pub(pid,{t:'pong'});else{changed();send(pid);}return;}
    if(m.t==='hello'){
      const name=String(m.name||'').trim().slice(0,14);
      if(!inGame()&&name&&!lobby.some(l=>l.pid===pid)&&lobby.length<4)lobby.push({pid,name,last:Date.now()});
      changed();send(pid);return;}
    if(!known)changed();
    if(m.t!=='act')return;
    const g=inGame();
    switch(m.a){
      /* salon */
      case 'join':{if(g)break;const name=String(m.name||'').trim().slice(0,14);if(!name)break;
        const l=lobby.find(x=>x.pid===pid);if(l)l.name=name;else if(lobby.length<4)lobby.push({pid,name,last:Date.now()});fillTv();break;}
      case 'leave':if(!g){lobby=lobby.filter(l=>l.pid!==pid);
        fillTv();}break;
      case 'start':{if(g||lobby.length<2||!lobby.some(l=>l.pid===pid))break;
        nPlayers=lobby.length;renderSetup();lobby.forEach((l,k)=>{const i=$('pn'+k);if(i)i.value=l.name});click('start');break;}
      case 'resume':if(!g)click('resume');break;
      /* identité en cours de partie */
      case 'iam':if(g&&m.k>=0&&m.k<S.players.length){const d=devs();
        Object.keys(d).forEach(x=>{if(d[x]===+m.k||x===pid)delete d[x]});d[pid]=+m.k;save();updTv();}break;
      case 'unbind':if(g){delete devs()[pid];save();updTv();}break;
      /* jeu */
      case 'roll':if(g&&S.phase==='roll'&&canPlay(pid))rollDie();break;
      case 'go':if(g&&S.phase==='choose'&&canPlay(pid))choose(+m.i);break;
      case 'fc':if(g&&S.phase==='final'&&canJudge(pid)&&m.k>=0&&m.k<6)ask(+m.k,false,true);break;
      case 'show':if(g&&S.phase==='question'&&canJudge(pid))click('showb');break;
      case 'ok':if(g&&S.phase==='question'&&canJudge(pid))click('okb');break;
      case 'ko':if(g&&S.phase==='question'&&canJudge(pid))click('kob');break;
      case 'again':if(g&&S.phase==='win')click('againb');break;
      case 'newgame':if(g)toSetup();break;
    }
    broadcast();
  }

  /* ---------- branchement sur les fonctions existantes ---------- */
  const _render=window.render;window.render=function(){const r=_render.apply(this,arguments);updTv();broadcast();return r;};
  const _veil=window.renderVeil;window.renderVeil=function(){const r=_veil.apply(this,arguments);broadcast();return r;};
  const _setup=window.renderSetup;window.renderSetup=function(){const r=_setup.apply(this,arguments);updTv();broadcast();return r;};
  const _enter=window.enterGame;window.enterGame=function(){const r=_enter.apply(this,arguments);bindLobby();updTv();broadcast();return r;};
  const _toSetup=window.toSetup;window.toSetup=function(){const r=_toSetup.apply(this,arguments);fillTv();return r;};
  /* le dé anime ~0,6 s avant de rendre le résultat : on prévient les téléphones dès le lancer */
  const _roll=window.rollDie;window.rollDie=function(){_roll.apply(this,arguments);broadcast();};

  $('qrbtn').onclick=()=>{$('qrveil').hidden=false;$('qrclose').focus({preventScroll:true});};
  $('qrclose').onclick=()=>{$('qrveil').hidden=true;focusMain();};
  $('qrveil').addEventListener('click',e=>{if(e.target.id==='qrveil'){$('qrveil').hidden=true;focusMain();}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('qrveil').hidden){$('qrveil').hidden=true;focusMain();}});

  showQr();updTv();
  start(bi);
})();
