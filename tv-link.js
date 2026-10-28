/* Les Camemberts — liaison TV ↔ téléphones (QR code + WebRTC via PeerJS).
   La TV reste maître de la partie : chaque téléphone s'identifie comme un joueur,
   reçoit une vue personnelle et envoie les mêmes actions que les boutons de l'écran.
   Le serveur PeerJS ne sert qu'à la mise en relation : une fois connectés, TV et
   téléphones échangent en direct (sur le Wi-Fi local quand tout le monde y est).
   Aucune règle du jeu n'est modifiée. */
(function(){
  if(typeof Peer==='undefined'||typeof qrcode==='undefined')return;
  const ROOM_KEY='camemberts-room',PREFIX='camemberts-';
  const ALPHA='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode=()=>Array.from({length:4},()=>ALPHA[Math.floor(Math.random()*ALPHA.length)]).join('');
  let code;try{code=localStorage.getItem(ROOM_KEY)}catch(e){}
  if(!code||!/^[A-Z0-9]{4}$/.test(code))code=newCode();
  let peer=null,retry=0,idTries=0;
  const conns=new Map();      // connexion -> {pid, seen}
  let lobby=[];               // salon avant partie : [{pid,name}]

  /* ---------- QR code ---------- */
  function qrSvg(text){const q=qrcode(0,'M');q.addData(text);q.make();return q.createSvgTag({cellSize:4,margin:0,scalable:true});}
  function joinUrl(){return new URL('manette.html?r='+code,location.href).href;}
  function showQr(){
    const svg=qrSvg(joinUrl());
    $('qrimg').innerHTML=svg;$('qrimg2').innerHTML=svg;
    $('qrcode').textContent=code;$('qrcode2').textContent='Code '+code;
    $('qrbox').hidden=false;$('qrbtn').hidden=false;
  }

  /* ---------- connexion ---------- */
  function start(){
    peer=new Peer(PREFIX+code,{debug:0});
    peer.on('open',()=>{retry=0;idTries=0;try{localStorage.setItem(ROOM_KEY,code)}catch(e){}showQr();});
    peer.on('connection',c=>{
      c.on('open',()=>{conns.set(c,{pid:null,seen:Date.now()});});
      c.on('data',m=>onMsg(c,m));
      const bye=()=>{if(conns.delete(c))changed();};
      c.on('close',bye);c.on('error',bye);
    });
    /* perte du serveur de mise en relation : on se ré-annonce sans couper les téléphones déjà connectés */
    peer.on('disconnected',()=>setTimeout(()=>{try{if(peer.disconnected&&!peer.destroyed)peer.reconnect()}catch(e){}},1500));
    peer.on('error',err=>{const t=err&&err.type;
      if(t==='unavailable-id'){ /* l'ancien onglet TV tient encore le code : on patiente puis on change de code */
        peer.destroy();if(++idTries>=4){code=newCode();idTries=0;}setTimeout(start,2500);return;}
      if(t==='browser-incompatible'||t==='ssl-unavailable')return;
      if(peer.destroyed){setTimeout(start,Math.min(15000,1500*(++retry)));}
      else if(peer.disconnected){setTimeout(()=>{try{peer.reconnect()}catch(e){}},Math.min(15000,1500*(++retry)));}
    });
  }
  /* un téléphone qui ne donne plus signe de vie depuis 12 s est considéré parti */
  setInterval(()=>{const now=Date.now();let gone=false;
    conns.forEach((v,c)=>{if(now-v.seen>12000){conns.delete(c);gone=true;try{c.close()}catch(e){}}});
    /* salon : on oublie un joueur déconnecté depuis plus de 45 s */
    if(!inGame()){const on=onlinePids(),before=lobby.length;
      lobby.forEach(l=>{if(on.has(l.pid))l.last=now;});
      lobby=lobby.filter(l=>on.has(l.pid)||now-(l.last||now)<45000);
      if(lobby.length!==before)gone=true;}
    if(gone)changed();},3000);

  /* ---------- qui est qui ---------- */
  const inGame=()=>!!(S&&!$('game').hidden);
  const devs=()=>{if(S&&!S.devices)S.devices={};return S?S.devices:{};};
  const onlinePids=()=>new Set([...conns.values()].map(v=>v.pid).filter(Boolean));
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
    $('qrcount').textContent=txt;
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
  function send(c){const v=conns.get(c);if(!v||!v.pid)return;try{c.open&&c.send({t:'state',v:view(v.pid)})}catch(e){}}
  let pending=false;
  function broadcast(){if(pending)return;pending=true;
    Promise.resolve().then(()=>{pending=false;conns.forEach((_,c)=>send(c));});}

  /* ---------- messages reçus ---------- */
  function click(id){const el=$(id);if(el&&!el.hidden&&!el.disabled)el.click();}
  function onMsg(c,m){
    const info=conns.get(c);if(!info||!m||typeof m!=='object')return;
    info.seen=Date.now();
    if(m.t==='ping'){try{c.send({t:'pong'})}catch(e){}return;}
    if(m.t==='hello'){
      const pid=String(m.pid||'').slice(0,40);if(!pid)return;
      /* un même téléphone qui revient : on ferme son ancienne connexion */
      conns.forEach((v,o)=>{if(o!==c&&v.pid===pid){conns.delete(o);try{o.close()}catch(e){}}});
      info.pid=pid;
      const name=String(m.name||'').trim().slice(0,14);
      if(!inGame()&&name&&!lobby.some(l=>l.pid===pid)&&lobby.length<4)lobby.push({pid,name,last:Date.now()});
      changed();send(c);return;}
    if(m.t!=='act')return;
    const pid=info.pid;if(!pid)return;
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

  start();
})();
