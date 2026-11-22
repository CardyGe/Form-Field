import {createStudy} from './scene.mjs';
const canvas=document.querySelector('canvas');
const slider=document.querySelector('input');
const play=document.querySelector('button');
const study=createStudy(canvas,1920,1080);
let phase=0, paused=false, previous=performance.now();
function pause(value) {
  paused=value;
  play.textContent=paused?'Play':'Pause';
}
slider.addEventListener('input',()=>{pause(true);phase=Number(slider.value);study.render(phase);});
play.addEventListener('click',()=>{previous=performance.now();pause(!paused);});
function tick(now) {
  if(!paused){phase=(phase+(now-previous)/6000)%1;study.render(phase);slider.value=phase;}
  previous=now;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
