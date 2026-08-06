// ===== SOUND ENGINE (Web Audio API, no external files) =====
let audioCtx=null;
let soundEnabled=true;
function getAudio(){
  if(!audioCtx) audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==='suspended') audioCtx.resume();
  return audioCtx;
}
function playTone(freq,dur,type='sine',vol=0.12,decay=true){
  if(!soundEnabled) return;
  try{
    const ctx=getAudio();
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    osc.type=type;
    osc.frequency.setValueAtTime(freq,ctx.currentTime);
    gain.gain.setValueAtTime(vol,ctx.currentTime);
    if(decay) gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+dur);
    osc.connect(gain);gain.connect(ctx.destination);
    osc.start();osc.stop(ctx.currentTime+dur);
  }catch(e){}
}
function playNoise(dur,vol=0.06){
  if(!soundEnabled) return;
  try{
    const ctx=getAudio();
    const buf=ctx.createBuffer(1,ctx.sampleRate*dur,ctx.sampleRate);
    const data=buf.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,2);
    const src=ctx.createBufferSource();
    const gain=ctx.createGain();
    src.buffer=buf;gain.gain.setValueAtTime(vol,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+dur);
    src.connect(gain);gain.connect(ctx.destination);
    src.start();
  }catch(e){}
}
// Haptics: use Capacitor native haptics on iOS/Android, fallback to navigator.vibrate
function vibrate(pattern=15){
  try{
    if(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics){
      window.Capacitor.Plugins.Haptics.impact({style:'light'});
    } else if(navigator.vibrate){
      navigator.vibrate(pattern);
    }
  }catch(e){}
}

const SFX={
  select(){playTone(800,0.06,'sine',0.08);vibrate(10)},
  play(){playTone(440,0.15,'triangle',0.1);playTone(660,0.12,'sine',0.06);vibrate(25)},
  discard(){playNoise(0.08,0.05);playTone(300,0.08,'sine',0.05);vibrate(15)},
  drawCard(){playTone(520,0.1,'sine',0.07);setTimeout(()=>playTone(620,0.08,'sine',0.05),60);vibrate(20)},
  yourTurn(){playTone(523,0.12,'triangle',0.08);setTimeout(()=>playTone(659,0.12,'triangle',0.08),120);setTimeout(()=>playTone(784,0.15,'triangle',0.1),240);vibrate([80,60,80,60,100])},
  idleNag(){playTone(659,0.2,'sine',0.07);setTimeout(()=>playTone(523,0.28,'sine',0.06),250);vibrate([60,120,60])},
  gameOver(){playTone(523,0.3,'triangle',0.1);setTimeout(()=>playTone(440,0.3,'triangle',0.1),300);setTimeout(()=>playTone(349,0.5,'triangle',0.12),600);vibrate([50,100,50,100,80])},
  win(){playTone(523,0.15,'triangle',0.1);setTimeout(()=>playTone(659,0.15,'triangle',0.1),150);setTimeout(()=>playTone(784,0.15,'triangle',0.1),300);setTimeout(()=>playTone(1047,0.3,'triangle',0.12),450);vibrate([30,50,30,50,60])},
  error(){playTone(200,0.15,'square',0.06);vibrate([50,30,50])},
  timeUp(){playTone(880,0.12,'square',0.06);setTimeout(()=>playTone(660,0.12,'square',0.06),130);setTimeout(()=>playTone(440,0.25,'square',0.07),260);vibrate([100,50,100])},
  undo(){playTone(500,0.08,'sine',0.06);playTone(400,0.08,'sine',0.05);vibrate(15)},
  // Celebratory ascending arpeggio (C5-E5-G5-C6) — distinct from every other
  // cue so an unlock never sounds like an error. Medium haptic burst.
  achievement(){playTone(523,0.12,'sine',0.09);setTimeout(()=>playTone(659,0.12,'sine',0.09),90);setTimeout(()=>playTone(784,0.12,'sine',0.09),180);setTimeout(()=>playTone(1047,0.3,'triangle',0.1),270);vibrate([40,40,40,40,90])}
};
function toggleSound(){
  soundEnabled=!soundEnabled;
  const icon=soundEnabled?'\u{1F50A}':'\u{1F507}';
  const lobbyBtn=document.getElementById('lobby-sound-btn');
  if(lobbyBtn) lobbyBtn.innerHTML=icon;
  const menuBtn=document.getElementById('sound-toggle-btn');
  if(menuBtn) menuBtn.textContent='Sound: '+(soundEnabled?'On':'Off');
  if(soundEnabled) SFX.select();
}
