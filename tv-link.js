/* Les Camemberts — liaison TV ↔ téléphones (QR code + WebRTC via PeerJS).
   La TV reste maître de la partie : chaque téléphone s'identifie comme un joueur,
   reçoit une vue personnelle et envoie les mêmes actions que les boutons de l'écran.
   Aucune règle du jeu n'est modifiée. */
(function(){
  if(typeof Peer==='undefined'||typeof qrcode==='undefined')return;
  const ROOM_KEY='camemberts-room',PREFIX='camemberts-';
  const ALPHA='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode=()=>Array.from({length:4},()=>ALPHA[Math.floor(Math.random()*ALPHA.length)]).join('');
  let code;try{code=localStorage.getItem(ROOM_KEY)}catch(e){}
  if(!code||!/^[A-Z0-9]{4}$/.test(code))code=newCode();
  let peer=null,retry=0;
  const conns=new Map();      // connexion -> pid (identifiant persistant du téléphone)
  let lobby=[];               // salon avant partie : [{pid,name}]

  function qrSvg(text){const q=qrcode(0,'M');q.addData(text);q.make();return q.createSvgTag({cellSize:4,margin:0,scalable:true});}
  function joinUrl(){return new URL('manette.html?r='+code,location.href).href;}
  function showQr(){
    const url=joinUrl(),svg=qrSvg(url);
    $('qrimg').innerHTML=svg;$('qrimg2').innerHTML=svg;
    $('qrcode').textContent=code;$('qrcode2').textContent='Code '+code;
    $('qrbox').hidden=false;$('qrbtn').hidden=false;
  }
  function updCount(){const n=new Set(conns.values()).size;$('qrn').textContent=n;
    $('qrcount').textContent=n?(n+(n>1?' téléphones connectés':' téléphone connecté')):'aucun téléphone connecté';}

  function start(){
    peer=new Peer(PREFIX+code,{debug:0});
    peer.on('open',()=>{retry=0;try{localStorage.setItem(ROOM_KEY,code)}catch(e){}showQr();});
    peer.on('connection',c=>{
      c.on('open',()=>{conns.set(c,null);updCount();});
      c.on('data',m=>onMsg(c,m));
      const bye=()=>{const pid=conns.get(c);conns.delete(c);updCount();
        if(pid&&![...conns.values()].includes(pid)&&!inGame()){lobby=lobby.filter(l=>l.pid!==pid);fillTv();}};
      c.on('close',bye);c.on('error',bye);
    });
    peer.on('disconnected',()=>{try{peer.reconnect()}catch(e){}});
    peer.on('error',err=>{
      if(err&&err.type==='unavailable-id'){peer.destroy();code=newCode();start();return;}
      if(err&&['network','server-error','socket-error','socket-closed'].includes(err.type)){
        peer.destroy();setTimeout(start,Math.min(15000,1500*(++retry)));}
    });
  }

  const inGame=()=>!!(S&&!$('game').hidden);
  const devs=()=>{if(S&&!S.devices)S.devices={};return S?S.devices:{};};
  const meOf=pid=>{const d=devs()[pid];return typeof d==='number'?d:-1;};
  const hasDev=k=>Object.values(devs()).includes(k);
  const othersHaveDev=k=>S.players.some((_,j)=>j!==k&&hasDev(j));

  /* qui a le droit de faire quoi (la télécommande TV peut toujours tout faire) */
  function canPlay(pid){const me=meOf(pid);return me===S.cur||!hasDev(S.cur);}            // lancer, choisir la case
  function canJudge(pid){const me=meOf(pid);return me!==S.cur||!othersHaveDev(S.cur);}    // voir la réponse, juger, choisir la catégorie finale

  /* remplit l'écran de configuration de la TV avec les joueurs du salon */
  function fillTv(){
    if(inGame()){broadcast();return;}
    if(lobby.length){nPlayers=Math.max(2,Math.min(4,lobby.length));renderSetup();
      lobby.forEach((l,k)=>{const i=$('pn'+k);if(i)i.value=l.name});}
    broadcast();
  }
  /* associe les téléphones du salon aux joueurs, par prénom */
  function bindLobby(){if(!S)return;const d=devs();
    lobby.forEach(l=>{if(typeof d[l.pid]==='number')return;
      const k=S.players.findIndex((p,j)=>p.name===l.name&&!Object.values(d).includes(j));if(k>=0)d[l.pid]=k;});
    save();}

  /* état envoyé à chaque téléphone, selon le joueur qu'il incarne */
  function view(pid){
    if(!inGame()){let resume=null;
      try{if(saved){const st=JSON.parse(saved.state);if(st.phase!=='win')resume=st.players.map(p=>p.name);}}catch(e){}
      return{mode:'setup',resume,lobby:lobby.map(l=>l.name),me:lobby.findIndex(l=>l.pid===pid)};}
    const p=S.players[S.cur],me=meOf(pid);
    const v={mode:'game',phase:S.phase,cur:S.cur,me,msg:S.msg||'',roll:S.roll,rolling:!!rolling,
      canPlay:me>=0&&canPlay(pid),canJudge:me>=0&&canJudge(pid),
      players:S.players.map((q,k)=>({name:q.name,wedges:q.wedges,color:PCOL[k],taken:hasDev(k)})),
      cats:CATS.map(c=>({name:c.name,color:c.color,ink:c.ink})),
      options:S.phase==='choose'?S.options.map((i,j)=>{const l=label(i);return{i,c:l.c,t:l.t,dir:S.options.length>1?(j?'↺':'↻'):''}}):[]};
    if(S.phase==='question'&&S.q){const c=CATS[S.q.cat],[q,a]=Q[c.id][S.q.idx];
      v.q={cat:c.name,color:c.color,ink:c.ink,text:q,shown:!!S.q.shown,
        answer:S.q.shown&&v.canJudge?a:null,tag:S.q.final?'Question finale':S.q.hq?'Case camembert':''};}
    if(S.phase==='win')v.winner=p.name;
    return v;
  }
  function send(c){try{c.open&&c.send({t:'state',v:view(conns.get(c))})}catch(e){}}
  let pending=false;
  function broadcast(){if(pending)return;pending=true;
    Promise.resolve().then(()=>{pending=false;conns.forEach((pid,c)=>{if(pid)send(c)});});}

  /* messages reçus */
  function click(id){const el=$(id);if(el&&!el.hidden&&!el.disabled)el.click();}
  function onMsg(c,m){
    if(!m||typeof m!=='object')return;
    if(m.t==='hello'){
      const pid=String(m.pid||'').slice(0,40);if(!pid)return;conns.set(c,pid);updCount();
      const name=String(m.name||'').trim().slice(0,14);
      if(!inGame()&&name&&!lobby.some(l=>l.pid===pid)&&lobby.length<4){lobby.push({pid,name});fillTv();}
      send(c);return;}
    if(m.t!=='act')return;
    const pid=conns.get(c);if(!pid)return;
    const g=inGame();
    switch(m.a){
      /* salon */
      case 'join':{if(g)break;const name=String(m.name||'').trim().slice(0,14);if(!name)break;
        const l=lobby.find(x=>x.pid===pid);if(l)l.name=name;else if(lobby.length<4)lobby.push({pid,name});fillTv();break;}
      case 'leave':if(!g){lobby=lobby.filter(l=>l.pid!==pid);fillTv();}break;
      case 'start':{if(g||lobby.length<2||!lobby.some(l=>l.pid===pid))break;
        nPlayers=lobby.length;renderSetup();lobby.forEach((l,k)=>{const i=$('pn'+k);if(i)i.value=l.name});click('start');break;}
      case 'resume':if(!g)click('resume');break;
      /* identité en cours de partie */
      case 'iam':if(g&&m.k>=0&&m.k<S.players.length){const d=devs();
        Object.keys(d).forEach(x=>{if(d[x]===+m.k)delete d[x]});d[pid]=+m.k;save();}break;
      case 'unbind':if(g){delete devs()[pid];save();}break;
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

  /* on se branche sur les fonctions existantes pour diffuser l'état */
  ['render','renderVeil','renderSetup'].forEach(n=>{const f=window[n];if(typeof f!=='function')return;
    window[n]=function(){const r=f.apply(this,arguments);broadcast();return r;};});
  const _enter=window.enterGame;window.enterGame=function(){const r=_enter.apply(this,arguments);bindLobby();broadcast();return r;};
  const _toSetup=window.toSetup;window.toSetup=function(){const r=_toSetup.apply(this,arguments);fillTv();return r;};
  /* le dé anime ~0,6 s avant de rendre le résultat : on prévient les téléphones dès le lancer */
  const _roll=window.rollDie;window.rollDie=function(){_roll.apply(this,arguments);broadcast();};

  $('qrbtn').onclick=()=>{$('qrveil').hidden=false;$('qrclose').focus({preventScroll:true});};
  $('qrclose').onclick=()=>{$('qrveil').hidden=true;focusMain();};
  $('qrveil').addEventListener('click',e=>{if(e.target.id==='qrveil'){$('qrveil').hidden=true;focusMain();}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('qrveil').hidden){$('qrveil').hidden=true;focusMain();}});

  start();
})();
