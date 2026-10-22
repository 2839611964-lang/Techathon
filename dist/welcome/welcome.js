const key = 'meiyu-welcome-v1';
const replay = new URLSearchParams(location.search).has('welcome');
try { if (!replay && localStorage.getItem(key)==='complete') location.replace('./app.html'); } catch {}
const stage=document.querySelector('#welcome');
const pages=[...document.querySelectorAll('.welcome-page')];
let current=0,phase='base',animations=[],changing=false;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
// Keep artwork mounted and decoded. Clicking never reloads media.
const ready=pages.map(page=>Promise.all([...page.querySelectorAll('img')].map(img=>img.decode().catch(()=>{}))));
function mark(state){phase=state;stage.dataset.phase=state;stage.dataset.page=String(current+1);}
const motions={
  gold:{frames:[{opacity:0},{opacity:1}],duration:650},
  portrait:{frames:[{opacity:0,transform:'translate3d(10%,0,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],duration:700},
  logo:{frames:[{opacity:0,transform:'translate3d(-7%,0,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],duration:850},
  window:{frames:[{opacity:0,transform:'translate3d(-22%,0,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],duration:750},
  caption:{frames:[{opacity:0},{opacity:1}],duration:500,delay:180},
  panel:{frames:[{opacity:0,clipPath:'inset(0 100% 0 0)'},{opacity:1,clipPath:'inset(0 0% 0 0)'}],duration:800},
  slogan:{frames:[{opacity:0},{opacity:1}],duration:1500},
};
async function reveal(){
  mark('animating');
  await ready[current];
  const layers=[...pages[current].querySelectorAll('.art-layer')];
  animations=layers.map(layer=>{
    const motion=motions[layer.dataset.motion];
    return layer.animate(motion.frames,{duration:reduced?1:motion.duration,delay:reduced?0:(motion.delay||0),easing:'cubic-bezier(.22,.61,.36,1)',fill:'forwards'});
  });
  await Promise.all(animations.map(a=>a.finished.catch(()=>{})));
  layers.forEach(layer=>{layer.style.opacity='1';layer.style.transform='none';layer.style.clipPath='none';});
  animations.forEach(a=>a.cancel());animations=[];
  mark('complete');
}
async function next(){
  if(changing)return;
  if(phase==='animating'){animations.forEach(a=>a.finish());return;}
  if(phase==='base'){reveal();return;}
  if(current===pages.length-1){
    try{localStorage.setItem(key,'complete');}catch{}
    location.assign('./app.html');return;
  }
  changing=true;
  await ready[current+1];
  const previous=pages[current],upcoming=pages[++current];
  upcoming.hidden=false;upcoming.setAttribute('aria-hidden','false');
  upcoming.style.zIndex='2';previous.style.zIndex='1';
  const transition=upcoming.animate([{opacity:0},{opacity:1}],{duration:reduced?1:180,easing:'ease-out'});
  await transition.finished.catch(()=>{});
  previous.hidden=true;previous.setAttribute('aria-hidden','true');
  previous.style.zIndex='';upcoming.style.zIndex='';
  mark('base');changing=false;
}
stage.addEventListener('click',next);
stage.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();next();}});
mark('base');
