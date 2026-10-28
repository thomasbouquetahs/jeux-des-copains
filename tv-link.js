/* Les Camemberts — liaison TV ↔ téléphones (QR code + WebRTC via PeerJS).
   La TV reste maître de la partie : les téléphones envoient les mêmes actions
   que les boutons de l'écran, et reçoivent l'état à afficher. Aucune règle du jeu n'est modifiée. */
(function(){
  if(typeof Peer==='undefined'||typeof qrcode==='undefined')return;
  const ROOM_KEY='camemberts-room',PREFIX='camemberts-';
  const ALPHA='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode=()=>Array.from({length:4},()=>ALPHA[Math.floor(Math.random()*ALPHA.length)]).join('');
  let code;try{code=localStorage.getItem(ROOM_KEY)}catch(e){}
  if(!code||!/^[A-Z0-9]{4}$/.test(code))code=newCode();
  let peer=null,conns=new Set(),retry=0;

  function qrSvg(text){const q=qrcode(0,'M');q.addData(text);q.make();return q.createSvgTag({cellSize:4,margin:0,scalable:true});}
  function joinUrl(){return new URL('manette.html?r='+code,location.href).href;}
  function showQr(){
    const url=joinUrl(),svg=qrSvg(url);
    $('qrimg').innerHTML=svg;$('qrimg2').innerHTML=svg;
    $('qrcode').textContent=code;$('qrcode2').textContent='Code '+code;
    $('qrbox').hidden=false;$('qrbtn').hidden=false;
  }
  function updCount(){const n=conns.size;$('qrn').textContent=n;
    $('qrcount').textContent=n?(n+(n>1?' téléphones connectés':' téléphone connecté')):'aucun téléphone connecté';}

  function start(){
    peer=new Peer(PREFIX+code,{debug:0});
    peer.on('open',()=>{retry=0;try{localStorage.setItem(ROOM_KEY,code)}catch(e){}showQr();});
    peer.on('connection',c=>{
      c.on('open',()=>{conns.add(c);updCount();send(c);});
      c.on('data',m=>onAct(m));
      c.on('close',()=>{conns.delete(c);updCount();});
      c.on('error',()=>{conns.delete(c);updCount();});
    });
    peer.on('disconnected',()=>{try{peer.reconnect()}catch(e){}});
    peer.on('error',err=>{
      if(err&&err.type==='unavailable-id'){peer.destroy();code=newCode();start();return;}
      if(err&&['network','server-error','socket-error','socket-closed'].includes(err.type)){
        peer.destroy();setTimeout(start,Math.min(15000,1500*(++retry)));}
    });
  }

  /* état envoyé aux téléphones */
  function view(){
    const inGame=!$('game').hidden&&S;
    if(!inGame){let resume=null;
      try{if(saved){const st=JSON.parse(saved.state);if(st.phase!=='win')resume=st.players.map(p=>p.name);}}catch(e){}
      return{mode:'setup',resume,n:nPlayers};}
    const p=S.players[S.cur];
    const v={mode:'game',phase:S.phase,cur:S.cur,msg:S.msg||'',roll:S.roll,rolling:!!rolling,
      players:S.players.map((q,k)=>({name:q.name,wedges:q.wedges,color:PCOL[k]})),
      cats:CATS.map(c=>({name:c.name,color:c.color,ink:c.ink})),
      options:S.phase==='choose'?S.options.map((i,j)=>{const l=label(i);return{i,c:l.c,t:l.t,dir:S.options.length>1?(j?'↺':'↻'):''}}):[]};
    if(S.phase==='question'&&S.q){const c=CATS[S.q.cat],[q,a]=Q[c.id][S.q.idx];
      v.q={cat:c.name,color:c.color,ink:c.ink,text:q,shown:!!S.q.shown,answer:S.q.shown?a:null,
        tag:S.q.final?'Question finale':S.q.hq?'Case camembert':''};}
    if(S.phase==='win')v.winner=p.name;
    return v;
  }
  function send(c){try{c.open&&c.send({t:'state',v:view()})}catch(e){}}
  let pending=false;
  function broadcast(){if(pending)return;pending=true;
    Promise.resolve().then(()=>{pending=false;if(!conns.size)return;const m={t:'state',v:view()};
      conns.forEach(c=>{try{c.open&&c.send(m)}catch(e){}});});}

  /* actions reçues : on rejoue exactement les boutons de la TV */
  function click(id){const el=$(id);if(el&&!el.hidden&&!el.disabled)el.click();}
  function onAct(m){
    if(!m||m.t!=='act')return;
    const inGame=!$('game').hidden&&S;
    switch(m.a){
      case 'start':{if(inGame)return;const names=(Array.isArray(m.names)?m.names:[]).slice(0,4).map(x=>String(x||'').slice(0,14));
        if(names.length<2)return;nPlayers=names.length;renderSetup();names.forEach((x,k)=>{const i=$('pn'+k);if(i)i.value=x});click('start');break;}
      case 'resume':if(!inGame)click('resume');break;
      case 'roll':if(inGame&&S.phase==='roll')rollDie();break;
      case 'go':if(inGame&&S.phase==='choose')choose(+m.i);break;
      case 'fc':if(inGame&&S.phase==='final'&&m.k>=0&&m.k<6)ask(+m.k,false,true);break;
      case 'show':if(inGame&&S.phase==='question')click('showb');break;
      case 'ok':if(inGame&&S.phase==='question')click('okb');break;
      case 'ko':if(inGame&&S.phase==='question')click('kob');break;
      case 'again':if(inGame&&S.phase==='win')click('againb');break;
      case 'newgame':if(inGame)toSetup();break;
    }
    broadcast();
  }

  /* on se branche sur les fonctions d'affichage existantes pour diffuser l'état */
  ['render','renderVeil','renderSetup','toSetup'].forEach(n=>{const f=window[n];if(typeof f!=='function')return;
    window[n]=function(){const r=f.apply(this,arguments);broadcast();return r;};});
  /* le dé anime ~0,6 s avant de rendre le résultat : on prévient les téléphones dès le lancer */
  const _roll=window.rollDie;window.rollDie=function(){_roll.apply(this,arguments);broadcast();};

  $('qrbtn').onclick=()=>{$('qrveil').hidden=false;$('qrclose').focus({preventScroll:true});};
  $('qrclose').onclick=()=>{$('qrveil').hidden=true;focusMain();};
  $('qrveil').addEventListener('click',e=>{if(e.target.id==='qrveil'){$('qrveil').hidden=true;focusMain();}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('qrveil').hidden){$('qrveil').hidden=true;focusMain();}});

  start();
})();
