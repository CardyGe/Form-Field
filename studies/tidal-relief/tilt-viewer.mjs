import {createStudy} from './scene.mjs';

const canvas=document.querySelector('canvas');
const slider=document.querySelector('input');
const play=document.querySelector('#play');
const jackpot=document.querySelector('#jackpot');
const study=createStudy(canvas,1920,1080,{arcade:true});
let phase=0,paused=false,last=performance.now(),bonus=Infinity;

function toggle(){
  paused=!paused;
  play.textContent=paused?'Play':'Pause';
  last=performance.now();
}
play.addEventListener('click',toggle);
slider.addEventListener('input',()=>{
  paused=true;play.textContent='Play';
  phase=Number(slider.value);bonus=Infinity;study.render(phase);
});
function fire(){bonus=0;if(paused)toggle();}
jackpot.addEventListener('click',fire);
canvas.addEventListener('pointerdown',fire);
window.addEventListener('keydown',event=>{
  if(event.code==='Space'&&event.target===document.body){
    event.preventDefault();if(!event.repeat)fire();
  }
});
function tick(now){
  if(!paused){
    const elapsed=(now-last)/1000;
    phase=(phase+elapsed/6)%1;bonus+=elapsed*2;
    study.render(phase,bonus);slider.value=phase;
  }
  last=now;requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
