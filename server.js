'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const WebSocket=require('ws');
const PORT=Number(process.env.PORT)||3000, W=1280,H=720,T=40,C=32,R=18,rooms=new Map();
const DIR={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
const MAX_PLAYERS=9;
function cleanName(v){return typeof v==='string'&&/^[A-Za-z]{1,8}$/.test(v.trim())?v.trim():null;}
function uniqueName(r,wanted,slot){const taken=new Set(r.players.map((p,i)=>i!==slot&&p?p.name.toLowerCase():null));let name=wanted||('Player'+(slot+1));if(!taken.has(name.toLowerCase()))return name;for(let i=1;i<10;i++){const candidate=(name.slice(0,7)+i).slice(0,8);if(!taken.has(candidate.toLowerCase()))return candidate;}return 'P'+slot;}
const THEMES=['city','forest','desert','snow','wetlands','industrial','canyon','ice','fortress','final'];
const TYPES={normal:{hp:2,speed:1.35,cool:48,score:100},fast:{hp:1,speed:2.35,cool:58,score:140},heavy:{hp:4,speed:.95,cool:52,score:260},sniper:{hp:2,speed:1.1,cool:95,score:220},smart:{hp:3,speed:1.55,cool:35,score:300},frost:{hp:3,speed:1.1,cool:55,score:300},assault:{hp:2,speed:1.5,cool:42,score:240},boss:{hp:35,speed:1.15,cool:18,score:1800}};
const DIFFICULTIES={easy:{hp:.8,damage:.75,spawn:1.2},normal:{hp:1,damage:1,spawn:1},hard:{hp:1.3,damage:1.5,spawn:.8}};
const bossMultiplier=l=>Math.pow(1.4,l/2-1);
const baseAt=r=>r.base||{x:660,y:660};
function randomFree(r,avoid=[],distance=120){for(let n=0;n<500;n++){const x=(1+Math.floor(Math.random()*(C-2)))*T+20,y=(1+Math.floor(Math.random()*(R-2)))*T+20;if(!solid(r,x,y,24)&&avoid.every(o=>Math.hypot(o.x-x,o.y-y)>distance))return {x,y};}return null;}
function setupBase(r){if(r.level<5){r.base={x:660,y:660};return;}const old=r.tiles.findIndex(t=>t?.t==='B');if(old>=0)r.tiles[old]=null;const spot=randomFree(r,[],0)||{x:660,y:660},bx=Math.floor(spot.x/T),by=Math.floor(spot.y/T);for(let y=by-2;y<=by+2;y++)for(let x=bx-2;x<=bx+2;x++)if(x>=0&&y>=0&&x<C&&y<R)r.tiles[y*C+x]=null;r.tiles[by*C+bx]={t:'B',hp:999};r.base={x:bx*T+20,y:by*T+20};}
function steer(r,e,target){const dx=target.x-e.x,dy=target.y-e.y;const a=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'),b=Math.abs(dx)>Math.abs(dy)?(dy>0?'down':'up'):(dx>0?'right':'left');for(const dir of [a,b,...Object.keys(DIR).sort(()=>Math.random()-.5)]){const d=DIR[dir];if(!solid(r,e.x+d[0]*35,e.y+d[1]*35,e.kind==='boss'?23:16)){e.dir=dir;return;}}}
function enemyGoal(r,e){const players=r.players.filter(p=>p&&!p.down);return players.length&&Math.random()<(e.kind==='smart'||e.kind==='boss'?.5:.2)?pick(players):baseAt(r);}
function dodge(r,e){if(e.kind!=='smart'&&e.kind!=='boss')return false;const b=r.bullets.find(b=>b.team==='player'&&Math.hypot(b.x-e.x,b.y-e.y)<110);if(!b)return false;for(const dir of (b.vx?['up','down']:['left','right']).sort(()=>Math.random()-.5)){const d=DIR[dir];if(!solid(r,e.x+d[0]*40,e.y+d[1]*40,e.kind==='boss'?23:16)){e.dir=dir;return true;}}return false;}
const pick=a=>a[Math.floor(Math.random()*a.length)];
const rand=(a,b)=>a+Math.random()*(b-a);
const tileIndex=(x,y)=>Math.floor(y/T)*C+Math.floor(x/T);
const inBounds=(x,y)=>x>=0&&y>=0&&x<W&&y<H;
function mapFor(level){const tiles=Array(C*R).fill('.');const put=(x,y,v)=>{if(x>=0&&x<C&&y>=0&&y<R)tiles[y*C+x]=v;};const seed=level*7919+1234;let s=seed;const rnd=()=>((s=(s*1664525+1013904223)>>>0)/4294967296);const chance=(x,y)=>{if(y<3||y>14||x<2||x>29)return false;if(Math.abs(x-16)<3&&y>10)return false;if(Math.abs(x-5)<2&&y>13||Math.abs(x-26)<2&&y>13)return false;return true;};for(let y=3;y<15;y++)for(let x=2;x<30;x++){if(!chance(x,y))continue;const v=rnd();if(v<.09)put(x,y,'#');else if(v<.12)put(x,y,'S');else if(v<.145)put(x,y,'W');else if(v<.325)put(x,y,'F');}// Clustered forest canopy: additional connected groves, while retaining roads around base.
for(let n=0;n<24;n++){const cx=2+Math.floor(rnd()*28),cy=3+Math.floor(rnd()*12);for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=cx+dx,yy=cy+dy;if(xx<2||xx>=30||yy<3||yy>=15||!chance(xx,yy))continue;if(dx*dx+dy*dy<=3+rnd()*2&&rnd()<.85&&tiles[yy*C+xx]==='.')put(xx,yy,'F');}}
// Per-stage forest density: 20–80% of the previous dense V2.3 layout.
const forestFraction=.2+rnd()*.6;
for(let y=0;y<R;y++)for(let xx=0;xx<C;xx++)if(tiles[y*C+xx]==='F'&&rnd()>forestFraction)tiles[y*C+xx]='.';
for(let y=14;y<18;y++)for(let x=14;x<=18;x++)put(x,y,'.');for(let x=14;x<=18;x++)put(x,15,'#');for(let x=14;x<=18;x++)put(x,17,'#');put(14,16,'#');put(18,16,'#');put(16,16,'B');put(15,16,'#');put(17,16,'#');for(let x of [3,16,28])for(let y=0;y<3;y++)put(x,y,'.');return tiles.map(v=>v==='#'?{t:v,hp:2}:v==='S'?{t:v,hp:999}:v==='B'?{t:v,hp:999}:v==='W'||v==='F'?{t:v,hp:0}:null);}
function roomNew(code){return {code,players:Array(MAX_PLAYERS).fill(null),paused:false,level:1,score:0,baseHp:5,phase:'waiting',tiles:[],enemies:[],bullets:[],powerups:[],effects:[],tick:0,spawned:0,killed:0,target:0,nextId:0,freeze:0,shared:{},bossMax:35,coins:0,shop:{damage:0,rate:0,speed:0,base:0},difficulty:'normal',base:{x:660,y:660}};}
function init(r){r.tiles=mapFor(r.level);setupBase(r);r.enemies=[];r.bullets=[];r.powerups=[];r.effects=[];r.tick=0;r.paused=false;r.spawned=0;r.killed=0;r.target=7+r.level*2;r.baseHp=5+r.shop.base;r.freeze=0;r.phase='playing';r.players.forEach((p,i)=>{if(p){Object.assign(p,{x:230+i*72,y:640,dir:'up',hp:3,shield:130,down:false,revive:0,cool:0,upgrade:0,rapid:0,pierce:0,frost:0,slow:0,input:{}});}});const used=[baseAt(r)];for(const p of r.players){if(!p)continue;const pos=randomFree(r,used,55);if(pos){p.x=pos.x;p.y=pos.y;used.push(pos);}}}
function solid(r,x,y,rad=16){if(x<rad||x>W-rad||y<rad||y>H-rad)return true;for(const xx of [x-rad,x+rad])for(const yy of [y-rad,y+rad]){const t=r.tiles[tileIndex(xx,yy)];if(t&&['#','S','W','B'].includes(t.t))return true;}return false;}
function move(r,o,dx,dy,rad=16){if(!solid(r,o.x+dx,o.y,rad))o.x+=dx;if(!solid(r,o.x,o.y+dy,rad))o.y+=dy;}
function resolveTankCollisions(r){const tanks=[...r.players.filter(p=>p&&!p.down),...r.enemies.filter(e=>!e.dead)];for(let pass=0;pass<3;pass++)for(let i=0;i<tanks.length;i++)for(let j=i+1;j<tanks.length;j++){const a=tanks[i],b=tanks[j],ra=a.kind==='boss'?25:18,rb=b.kind==='boss'?25:18,min=ra+rb;let dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy);if(dist>=min)continue;if(dist<.001){dx=(i+j)%2?1:0;dy=dx?0:1;dist=1;}const nx=dx/dist,ny=dy/dist,push=(min-dist)/2+0.35;const ax=a.x-nx*push,ay=a.y-ny*push,bx=b.x+nx*push,by=b.y+ny*push;if(!solid(r,ax,ay,ra-2)){a.x=ax;a.y=ay;}if(!solid(r,bx,by,rb-2)){b.x=bx;b.y=by;}}}
function fx(r,x,y,kind){r.effects.push({x,y,kind,life:kind==='big'?13:7,id:++r.nextId});if(r.effects.length>40)r.effects.shift();}
function fire(r,o,team){if(o.cool>0)return;const isPlayer=team==='player';const sp=isPlayer?9:6;const d=DIR[o.dir]||DIR.up;const double=isPlayer&&o.upgrade>=1;const shots=double?[-9,9]:[0];for(const offset of shots){const sideways=(d[0]!==0?[0,1]:[1,0]);r.bullets.push({id:++r.nextId,x:o.x+d[0]*25+sideways[0]*offset,y:o.y+d[1]*25+sideways[1]*offset,vx:d[0]*sp,vy:d[1]*sp,team,owner:o.id,damage:isPlayer?(o.upgrade>=3?2:1)+r.shop.damage:1,pierce:isPlayer&&o.pierce>0?2:0,dead:false});}o.cool=isPlayer?Math.max(4,(o.rapid>0?6:16)-r.shop.rate*2):o.kind==='boss'?Math.max(8,18-r.level):o.kind==='sniper'?80:TYPES[o.kind].cool;}
function spawn(r){const options=['normal','normal','fast'];if(r.level>=3)options.push('heavy','smart');if(r.level>=4)options.push('sniper','frost');if(r.level>=5)options.push('assault');const kind=r.level%2===0&&r.spawned===r.target-1?'boss':pick(options);const pos=r.level>=5?randomFree(r,[baseAt(r),...r.players.filter(Boolean)],125):{x:[110,640,1170][r.spawned%3],y:55};if(!pos)return;const st=TYPES[kind],scale=kind==='boss'?bossMultiplier(r.level):1,hp=Math.max(1,Math.ceil(st.hp*scale*DIFFICULTIES[r.difficulty].hp));r.enemies.push({id:++r.nextId,x:pos.x,y:pos.y,dir:'down',kind,hp,maxHp:hp,cool:40,step:0,shield:0,frostCooldown:0,attackScale:scale});r.spawned++;}
function damageEnemy(r,e,dmg){e.hp-=dmg;fx(r,e.x,e.y,'hit');if(e.hp<=0&&!e.dead){e.dead=true;r.killed++;r.score+=TYPES[e.kind].score;r.coins+=Math.round(TYPES[e.kind].score/20);fx(r,e.x,e.y,'big');if(Math.random()<.3||e.kind==='boss')r.powerups.push({id:++r.nextId,x:e.x,y:e.y,type:pick(['shield','repair','freeze','bomb','upgrade','rapid','pierce','heal'])});}}

// Server-controlled AI teammate: no external API or network service required.
function botThink(r){
 const bot=r.players[1],human=r.players[0];
 if(!bot||!bot.bot||bot.down)return;
 const input={up:false,down:false,left:false,right:false,fire:false,rescue:false};
 if(human&&human.down){
   const dx=human.x-bot.x,dy=human.y-bot.y;
   if(Math.hypot(dx,dy)<65){input.rescue=true;bot.input=input;return;}
   if(Math.abs(dx)>22)input[dx>0?'right':'left']=true;
   else if(Math.abs(dy)>20)input[dy>0?'down':'up']=true;
   bot.input=input;return;
 }
 const enemies=r.enemies.filter(e=>!e.dead);
 if(!enemies.length){bot.input=input;return;}
 // Prefer enemies threatening the base, but also defend nearby teammates.
 const target=enemies.slice().sort((a,b)=>
  (Math.hypot(a.x-baseAt(r).x,a.y-baseAt(r).y)*.6+Math.hypot(a.x-bot.x,a.y-bot.y)*.4)-
  (Math.hypot(b.x-baseAt(r).x,b.y-baseAt(r).y)*.6+Math.hypot(b.x-bot.x,b.y-bot.y)*.4))[0];
 const dx=target.x-bot.x,dy=target.y-bot.y;
 const aligned=Math.abs(dx)<24||Math.abs(dy)<24;
 if(Math.abs(dx)<24){bot.dir=dy>0?'down':'up';}
 else if(Math.abs(dy)<24){bot.dir=dx>0?'right':'left';}
 else if(Math.abs(dx)>Math.abs(dy)){input[dx>0?'right':'left']=true;}
 else{input[dy>0?'down':'up']=true;}
 // If movement is blocked, periodically try another approach.
 if(r.tick%110>=85&&r.tick%110<100){
   for(const k of ['up','down','left','right'])input[k]=false;
   input[dx>0?'right':'left']=true;
 }
 input.fire=aligned||r.tick%18===0;
 bot.input=input;
}
function update(r){if(r.phase!=='playing'||r.paused)return;r.tick++;botThink(r);if(r.freeze>0)r.freeze--;for(const p of r.players){if(!p)continue;if(p.cool>0)p.cool--;if(p.shield>0)p.shield--;if(p.rapid>0)p.rapid--;if(p.pierce>0)p.pierce--;if(p.frost>0)p.frost--;else if(p.slow>0)p.slow--;const a=p.input||{};if(p.down)continue;let dx=Number(!!a.right)-Number(!!a.left),dy=Number(!!a.down)-Number(!!a.up);if(dx||dy){if(Math.abs(dx)>=Math.abs(dy)&&dx)p.dir=dx>0?'right':'left';else if(dy)p.dir=dy>0?'down':'up';move(r,p,dx*3.5*(1+r.shop.speed*.12)*(p.frost>0?0:p.slow>0?.5:1),dy*3.5*(1+r.shop.speed*.12)*(p.frost>0?0:p.slow>0?.5:1));}if(a.fire&&p.frost<=0)fire(r,p,'player');}
for(const p of r.players){if(!p||!p.down)continue;const mate=r.players.find(q=>q&&q!==p&&!q.down);if(mate&&Math.hypot(mate.x-p.x,mate.y-p.y)<65&&mate.input&&mate.input.rescue){p.revive++;if(p.revive>=35){p.down=false;p.hp=2;p.shield=140;p.revive=0;fx(r,p.x,p.y,'big');}}else p.revive=Math.max(0,p.revive-2);}
if(r.spawned<r.target&&r.tick%Math.max(20,Math.floor(Math.max(36,66-r.level*2)*DIFFICULTIES[r.difficulty].spawn))===0&&r.enemies.length<Math.min(9,4+Math.floor(r.level/2)))spawn(r);
if(r.freeze===0)for(const e of r.enemies){e.step++;if(e.cool>0)e.cool--;if(e.frostCooldown>0)e.frostCooldown--;if(e.kind==='frost'&&e.frostCooldown===0){let hit=false;for(const p of r.players){if(p&&!p.down&&Math.hypot(p.x-e.x,p.y-e.y)<=80){p.frost=60;p.slow=60;hit=true;fx(r,p.x,p.y,'ice');}}if(hit)e.frostCooldown=180;}if(e.step%(e.kind==='boss'?12:e.kind==='smart'?18:40)===0){if(!dodge(r,e))steer(r,e,enemyGoal(r,e));}const d=DIR[e.dir],speed=TYPES[e.kind].speed*(e.kind==='boss'?Math.min(1.7,1+(r.level/2-1)*.12):1)*(e.kind==='assault'&&e.step%100<20?1.8:1);if(solid(r,e.x+d[0]*speed,e.y+d[1]*speed,e.kind==='boss'?23:16))steer(r,e,enemyGoal(r,e));else move(r,e,d[0]*speed,d[1]*speed,e.kind==='boss'?23:16);if(e.cool<=0)fire(r,e,'enemy');if(e.kind==='boss'&&r.level>=4&&e.step%90===0){e.cool=0;if(r.level>=6&&r.enemies.length<8&&e.step%180===0){const pos=randomFree(r,[baseAt(r)],130);if(pos)r.enemies.push({id:++r.nextId,...pos,dir:'down',kind:'normal',hp:2,maxHp:2,cool:30,step:0,shield:0});}}if(e.kind==='boss'&&r.level>=8&&e.step%180===0)for(const p of r.players)if(p&&!p.down&&Math.hypot(p.x-e.x,p.y-e.y)<100){p.frost=60;p.slow=60;}}
resolveTankCollisions(r);
// Move all projectiles first, then resolve projectile-v-projectile collisions on the authoritative server.
for(const b of r.bullets){b.prevX=b.x;b.prevY=b.y;b.x+=b.vx;b.y+=b.vy;if(!inBounds(b.x,b.y))b.dead=true;}
for(let i=0;i<r.bullets.length;i++){const a=r.bullets[i];if(a.dead)continue;for(let j=i+1;j<r.bullets.length;j++){const b=r.bullets[j];if(b.dead||a.team===b.team)continue;const ax=a.x-a.prevX,ay=a.y-a.prevY,bx=b.x-b.prevX,by=b.y-b.prevY,rx=a.prevX-b.prevX,ry=a.prevY-b.prevY,vx=ax-bx,vy=ay-by;const t=Math.max(0,Math.min(1,-(rx*vx+ry*vy)/(vx*vx+vy*vy||1)));if(Math.hypot(rx+vx*t,ry+vy*t)<=11){a.dead=b.dead=true;fx(r,(a.x+b.x)/2,(a.y+b.y)/2,'clash');break;}}}
for(const b of r.bullets){if(b.dead)continue;const idx=tileIndex(b.x,b.y),tile=r.tiles[idx];if(tile&&tile.t!=='F'&&tile.t!=='W'){if(tile.t==='#'){tile.hp-=b.damage;if(tile.hp<=0)r.tiles[idx]=null;fx(r,b.x,b.y,'hit');}else if(tile.t==='B'&&b.team==='enemy'){r.baseHp-=Math.max(1,Math.round(DIFFICULTIES[r.difficulty].damage*(r.enemies.find(e=>e.id===b.owner)?.attackScale||1)));fx(r,b.x,b.y,'big');}if(tile.t!=='B'||b.team==='enemy'){if(b.pierce>0&&tile.t==='#')b.pierce--;else b.dead=true;}else b.dead=true;}if(b.dead)continue;if(b.team==='player'){for(const e of r.enemies){if(e.dead)continue;if(Math.hypot(e.x-b.x,e.y-b.y)<(e.kind==='boss'?33:22)){damageEnemy(r,e,b.damage);if(b.pierce>0)b.pierce--;else b.dead=true;break;}}}else{for(const p of r.players){if(!p||p.down||p.shield>0)continue;if(Math.hypot(p.x-b.x,p.y-b.y)<21){p.hp-=Math.max(1,Math.round(DIFFICULTIES[r.difficulty].damage*(r.enemies.find(e=>e.id===b.owner)?.attackScale||1)));p.shield=85;b.dead=true;fx(r,p.x,p.y,'hit');if(p.hp<=0){p.down=true;p.revive=0;fx(r,p.x,p.y,'big');}break;}}}}
r.enemies=r.enemies.filter(e=>!e.dead);r.bullets=r.bullets.filter(b=>!b.dead).slice(-140);
for(const u of r.powerups){for(const p of r.players){if(!p||p.down||Math.hypot(p.x-u.x,p.y-u.y)>30)continue;u.dead=true;fx(r,u.x,u.y,'pickup');if(u.type==='shield')r.players.forEach(q=>{if(q)q.shield=Math.max(q.shield,260)});if(u.type==='repair')r.baseHp=Math.min(5+r.shop.base,r.baseHp+2);if(u.type==='freeze')r.freeze=180;if(u.type==='bomb'){for(const e of r.enemies.slice())damageEnemy(r,e,e.kind==='boss'?6:100);}if(u.type==='upgrade')r.players.forEach(q=>{if(q)q.upgrade=Math.min(3,q.upgrade+1)});if(u.type==='rapid')r.players.forEach(q=>{if(q)q.rapid=500});if(u.type==='pierce')r.players.forEach(q=>{if(q)q.pierce=450});if(u.type==='heal')r.players.forEach(q=>{if(q){q.hp=3;q.down=false;q.shield=100;}});break;}}
r.powerups=r.powerups.filter(u=>!u.dead);for(const e of r.effects)e.life--;r.effects=r.effects.filter(e=>e.life>0);
if(r.baseHp<=0||r.players.filter(Boolean).every(p=>p.down))r.phase='lost';else if(r.spawned>=r.target&&r.enemies.length===0)r.phase=r.level>=10?'complete':'won';}
function send(ws,msg){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(msg));}
function broadcast(r){const state={type:'state',code:r.code,level:r.level,theme:THEMES[r.level-1],score:r.score,coins:r.coins,shop:r.shop,difficulty:r.difficulty,baseHp:r.baseHp,base:r.base,phase:r.phase,paused:r.paused,host:0,maxPlayers:MAX_PLAYERS,tiles:r.tiles,players:r.players.map(p=>p?{name:p.name,bot:!!p.bot,x:p.x,y:p.y,dir:p.dir,hp:p.hp,shield:p.shield,down:p.down,revive:p.revive,upgrade:p.upgrade,rapid:p.rapid,pierce:p.pierce,frost:p.frost,slow:p.slow}:null),enemies:r.enemies.map(({x,y,dir,hp,maxHp,kind,id})=>({x,y,dir,hp,maxHp,kind,id})),bullets:r.bullets.map(({x,y,team,id})=>({x,y,team,id})),powerups:r.powerups,effects:r.effects,killed:r.killed,target:r.target,freeze:r.freeze};for(const p of r.players)if(p&&p.ws)send(p.ws,state);}
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=pathname==='/'?'index.html':pathname.slice(1);if(!['index.html','client.js'].includes(file)){res.writeHead(404);return res.end('Not found');}fs.readFile(path.join(__dirname,file),(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);});});
const wss=new WebSocket.Server({server});wss.on('connection',ws=>{let room=null,slot=-1;ws.on('message',raw=>{if(raw.length>4096)return;let m;try{m=JSON.parse(raw);}catch{return;}if(!m||typeof m!=='object')return;
if(m.type==='create'||m.type==='solo'||m.type==='bot'){if(room)return;const name=cleanName(m.name);if(!name)return send(ws,{type:'error',message:'invalidName'});let code;do{code=String(crypto.randomInt(100000,1000000));}while(rooms.has(code));room=roomNew(code);if(DIFFICULTIES[m.difficulty])room.difficulty=m.difficulty;rooms.set(code,room);slot=0;room.players[0]={ws,id:0,name,input:{}};if(m.type==='bot')room.players[1]={ws:null,id:1,name:'Bot',bot:true,input:{}};send(ws,{type:'joined',code,slot});if(m.type==='solo'||m.type==='bot')init(room);broadcast(room);
}else if(m.type==='join'){if(room)return;const name=cleanName(m.name);if(!name)return send(ws,{type:'error',message:'invalidName'});const r=rooms.get(String(m.code||''));if(!r||r.phase!=='waiting')return send(ws,{type:'error',message:'roomUnavailable'});const open=r.players.findIndex(p=>!p);if(open<0)return send(ws,{type:'error',message:'roomUnavailable'});room=r;slot=open;r.players[slot]={ws,id:slot,name:uniqueName(r,name,slot),input:{}};send(ws,{type:'joined',code:r.code,slot});broadcast(r);
}else if(m.type==='start'&&room&&slot===0&&room.phase==='waiting'){init(room);broadcast(room);
}else if(m.type==='pause'&&room&&slot===0&&['playing','paused'].includes(room.phase)){room.paused=!room.paused;broadcast(room);
}else if(m.type==='difficulty'&&room&&slot===0&&room.phase==='waiting'&&DIFFICULTIES[m.value]){room.difficulty=m.value;broadcast(room);
}else if(m.type==='buy'&&room&&slot===0&&room.phase==='won'&&['damage','rate','speed','base'].includes(m.item)){const n=room.shop[m.item],cost=100*(n+1);if(n<5&&room.coins>=cost){room.coins-=cost;room.shop[m.item]++;broadcast(room);}
}else if(m.type==='input'&&room&&slot>=0&&room.players[slot]){const k=m.keys||{};room.players[slot].input=Object.fromEntries(['up','down','left','right','fire','rescue'].map(key=>[key,k[key]===true]));
}else if(m.type==='next'&&room&&slot===0&&room.phase!=='waiting'){room.level=room.level>=10?1:room.level+1;init(room);broadcast(room);
}else if(m.type==='restart'&&room&&slot===0&&room.phase!=='waiting'){room.level=1;room.score=0;room.coins=0;room.shop={damage:0,rate:0,speed:0,base:0};init(room);broadcast(room);}
});ws.on('close',()=>{if(!room)return;room.players[slot]=null;if(slot===0){room.players.forEach(p=>{if(p&&p.ws)send(p.ws,{type:'error',message:'partnerLeft'});});rooms.delete(room.code);}else if(room.players.every(p=>!p||p.bot)){rooms.delete(room.code);}else{if(room.phase==='playing'&&room.players.filter(Boolean).every(p=>p.down))room.phase='lost';broadcast(room);}});});
setInterval(()=>{for(const r of rooms.values()){update(r);broadcast(r);}},50);
server.listen(PORT,'0.0.0.0',()=>console.log('Tank Defense V2 listening on '+PORT));
