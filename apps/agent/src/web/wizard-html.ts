// 설치 마법사 웹 UI(정적 HTML 문자열). 에이전트 로컬 웹서버가 127.0.0.1 에서 이걸 서빙하고,
// 화면의 버튼들은 같은 서버의 /api/* 엔드포인트를 호출해 기존 CLI 로직(pair/add/login/accounts)을 실행한다.
// ★비개발자 대상: 터미널 0, 클릭만. 채널 세션은 이 컴퓨터에만 저장(서버로 안 감).

export const WIZARD_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QualiFlow 설치</title>
<style>
  :root { --ink:#1c1b22; --ink2:#5b5966; --muted:#8a8794; --line:#e7e5ee; --bg:#f6f5fb; --card:#fff; --primary:#4f46e5; --on-primary:#fff; --ok-bg:#e7f6ef; --ok:#0f7a52; --warn-bg:#fdf3e3; --warn:#9a6800; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Apple SD Gothic Neo",sans-serif; background:var(--bg); color:var(--ink); }
  .wrap { max-width:560px; margin:0 auto; padding:40px 20px; }
  .brand { display:flex; align-items:center; gap:10px; margin-bottom:22px; }
  .logo { width:30px; height:30px; border-radius:8px; background:var(--primary); color:var(--on-primary); display:flex; align-items:center; justify-content:center; font-weight:600; }
  .brand b { font-weight:600; font-size:16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:24px; }
  .stepper { display:flex; align-items:center; gap:8px; margin-bottom:22px; }
  .dot { width:24px; height:24px; border-radius:50%; background:var(--bg); color:var(--muted); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:600; }
  .dot.cur { background:var(--primary); color:var(--on-primary); }
  .dot.done { background:var(--ok); color:#fff; }
  .stepper .lbl { font-size:13px; color:var(--ink2); }
  .stepper .ln { flex:1; height:1px; background:var(--line); min-width:12px; }
  h2 { font-size:17px; font-weight:600; margin:0 0 4px; }
  p.sub { font-size:13.5px; color:var(--ink2); line-height:1.6; margin:0 0 16px; }
  .row { display:flex; gap:10px; align-items:center; }
  input[type=text] { flex:1; height:40px; border:1px solid var(--line); border-radius:9px; padding:0 12px; font-size:15px; font-family:inherit; letter-spacing:1px; }
  input[type=text]:focus { outline:none; border-color:var(--primary); }
  button { height:40px; padding:0 16px; border-radius:9px; border:1px solid var(--line); background:var(--card); color:var(--ink); font-size:14px; font-weight:500; cursor:pointer; font-family:inherit; }
  button:hover { background:var(--bg); }
  button.primary { background:var(--primary); color:var(--on-primary); border-color:transparent; }
  button.primary:hover { filter:brightness(1.05); }
  button:disabled { opacity:.5; cursor:default; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
  .ch { border:1px solid var(--line); border-radius:12px; padding:14px; }
  .ch.on { border-color:var(--ok); }
  .ch .top { display:flex; align-items:center; gap:10px; }
  .ch .ic { width:34px; height:34px; border-radius:8px; background:var(--bg); display:flex; align-items:center; justify-content:center; font-size:18px; }
  .ch .nm { font-weight:600; font-size:14px; }
  .ch .hw { font-size:12px; color:var(--muted); }
  .badge { font-size:12px; padding:3px 9px; border-radius:20px; background:var(--bg); color:var(--muted); white-space:nowrap; }
  .badge.ok { background:var(--ok-bg); color:var(--ok); }
  .badge.warn { background:var(--warn-bg); color:var(--warn); }
  .ch .note { font-size:12px; color:var(--warn); margin-top:8px; line-height:1.5; }
  .ch .act { margin-top:10px; text-align:right; }
  .foot { display:flex; justify-content:space-between; align-items:center; margin-top:22px; padding-top:16px; border-top:1px solid var(--line); }
  .hint { font-size:13px; color:var(--muted); }
  .link { color:var(--primary); text-decoration:none; font-size:13px; }
  .sec { font-size:12px; color:var(--muted); margin-top:12px; line-height:1.6; }
  .done-ic { width:54px; height:54px; border-radius:50%; background:var(--ok-bg); color:var(--ok); display:flex; align-items:center; justify-content:center; font-size:30px; margin:0 auto 12px; }
  .pill { display:inline-flex; align-items:center; gap:6px; font-size:13px; background:var(--bg); border:1px solid var(--line); border-radius:20px; padding:4px 11px; margin:0 6px 6px 0; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><div class="logo">Q</div><b>QualiFlow 설치</b></div>
  <div class="card">
    <div class="stepper" id="stepper"></div>
    <div id="body"></div>
    <div class="foot">
      <button id="back" style="visibility:hidden">이전</button>
      <div class="hint" id="hint"></div>
      <button id="next" class="primary">다음</button>
    </div>
  </div>
</div>
<script>
var STEPS=["계정 연결","채널 연결","완료"];
var CH={
  whatsapp:{nm:"WhatsApp",ic:"\\uD83D\\uDCAC",hw:"QR 스캔",note:"폰 → 설정 → 연결된 기기 → 화면의 QR 스캔"},
  alibaba:{nm:"Alibaba",ic:"\\uD83C\\uDFEC",hw:"로그인 창",note:"열린 창에서 평소처럼 로그인하세요"},
  instagram:{nm:"Instagram",ic:"\\uD83D\\uDCF7",hw:"로그인 창",note:"열린 창에서 로그인하세요"},
  telegram:{nm:"Telegram",ic:"\\u2708\\uFE0F",hw:"전화 코드",note:"전화번호 입력 → 받은 코드 입력"}
};
var st={step:0,paired:false,accounts:[],connecting:{}};

function api(path,body){ return fetch(path,{method:body?"POST":"GET",headers:{"content-type":"application/json"},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json()}); }
function $(id){return document.getElementById(id);}
function isOn(ch){ return st.accounts.some(function(a){return a.channel===ch}) || st.connecting[ch]==="done"; }

function loadStatus(){ return api("/api/status").then(function(s){ st.paired=!!s.paired; st.accounts=s.accounts||[]; }); }

function stepper(){
  $("stepper").innerHTML=STEPS.map(function(t,i){
    var c=i<st.step?"done":i===st.step?"cur":"";
    var ic=i<st.step?"\\u2713":(i+1);
    var ln=i<STEPS.length-1?'<span class="ln"></span>':'';
    return '<span class="dot '+c+'">'+ic+'</span><span class="lbl">'+t+'</span>'+ln;
  }).join("");
}

function render(){
  stepper();
  var b=$("body");
  if(st.step===0){
    if(st.paired){
      b.innerHTML='<h2>계정 연결됨</h2><p class="sub">이 컴퓨터가 회사 CRM 계정에 연결됐습니다. 다음으로 진행하세요.</p>'
        +'<span class="badge ok">\\u2713 연결됨</span>';
    } else {
      b.innerHTML='<h2>회사 CRM 계정에 연결</h2><p class="sub">대시보드에서 연결 코드를 받아 아래에 붙여넣으세요. 한 번만 하면 됩니다.</p>'
        +'<div class="row"><input id="code" type="text" placeholder="XXXX-XXXX" autocomplete="off" /><button class="primary" id="pair">연결</button></div>'
        +'<div style="margin-top:10px"><a class="link" id="getcode" href="#">대시보드에서 코드 받기 \\u2197</a> <span id="perr" style="color:#c0392b;font-size:13px;margin-left:8px"></span></div>'
        +'<div class="sec">\\uD83D\\uDD12 채널 로그인·세션은 이 컴퓨터에만 저장되고 서버로 가지 않습니다.</div>';
    }
    $("hint").textContent=st.paired?"연결됨 — 다음으로":"";
  } else if(st.step===1){
    b.innerHTML='<h2>채널 연결</h2><p class="sub">연결할 채널의 <b>연결</b>을 누르세요. 로그인 창이 뜨면 평소처럼 로그인하면 됩니다.</p><div class="grid" id="grid"></div>';
    grid();
    var n=Object.keys(CH).filter(isOn).length;
    $("hint").textContent=n>0?(n+"개 연결됨"):"최소 1개 연결하세요";
  } else {
    var on=Object.keys(CH).filter(isOn);
    b.innerHTML='<div style="text-align:center;padding:10px 0 4px"><div class="done-ic">\\u2713</div>'
      +'<h2 style="text-align:center">준비 완료</h2>'
      +'<p class="sub" style="text-align:center;max-width:380px;margin:0 auto 4px">이제 대시보드에 메시지가 실시간으로 들어옵니다. 이 창은 닫아도 백그라운드에서 계속 동기화됩니다.</p></div>'
      +'<div style="background:var(--bg);border-radius:12px;padding:14px;margin-top:14px"><div style="font-size:12px;color:var(--muted);margin-bottom:8px">연결된 채널</div>'
      +(on.length?on.map(function(k){return '<span class="pill">'+CH[k].ic+' '+CH[k].nm+'</span>'}).join(""):'<span class="hint">아직 없음</span>')+'</div>';
    $("hint").textContent="";
  }
  $("back").style.visibility=st.step===0?"hidden":"visible";
  var nx=$("next");
  nx.textContent=st.step===2?"대시보드 열기":"다음";
  var blocked=(st.step===0&&!st.paired);
  nx.disabled=blocked;
}

function grid(){
  $("grid").innerHTML=Object.keys(CH).map(function(k){
    var c=CH[k], on=isOn(k), busy=st.connecting[k]==="busy";
    var badge=on?'<span class="badge ok">\\u2713 연결됨</span>':busy?'<span class="badge warn">연결 중\\u2026</span>':'<span class="badge">미연결</span>';
    var note=busy?'<div class="note">'+c.note+'</div>':'';
    var btn=on?'<button data-k="'+k+'">다시 연결</button>':busy?'<button disabled>창에서 로그인</button>':'<button class="primary" data-k="'+k+'">연결</button>';
    return '<div class="ch '+(on?"on":"")+'"><div class="top"><span class="ic">'+c.ic+'</span><div style="flex:1"><div class="nm">'+c.nm+'</div><div class="hw">'+c.hw+'</div></div>'+badge+'</div>'+note+'<div class="act">'+btn+'</div></div>';
  }).join("");
}

document.addEventListener("click",function(e){
  var t=e.target.closest("button,a"); if(!t) return;
  if(t.id==="getcode"){ e.preventDefault(); api("/api/cloud-url").then(function(r){ window.open(r.url+"/settings/agent","_blank"); }); return; }
  if(t.id==="pair"){
    var code=($("code").value||"").trim(); if(!code) return;
    $("perr").textContent=""; t.disabled=true; t.textContent="연결 중\\u2026";
    api("/api/pair",{code:code}).then(function(r){
      if(r.ok){ st.paired=true; render(); }
      else { $("perr").textContent=r.message||"코드를 확인하세요"; t.disabled=false; t.textContent="연결"; }
    }).catch(function(){ $("perr").textContent="연결 실패 — 다시 시도하세요"; t.disabled=false; t.textContent="연결"; });
    return;
  }
  if(t.id==="back"){ if(st.step>0){st.step--; render();} return; }
  if(t.id==="next"){
    if(st.step===2){ api("/api/cloud-url").then(function(r){ window.open(r.url,"_blank"); }); return; }
    if(st.step===0&&!st.paired) return;
    st.step++; render(); return;
  }
  if(t.dataset&&t.dataset.k){
    var k=t.dataset.k; st.connecting[k]="busy"; grid();
    api("/api/connect",{channel:k}).then(function(r){
      if(r.ok){ st.connecting[k]="done"; }
      else { st.connecting[k]=null; }
      return loadStatus();
    }).then(grid).catch(function(){ st.connecting[k]=null; grid(); });
    return;
  }
});

loadStatus().then(render).catch(function(){ render(); });
setInterval(function(){ if(st.step===1) loadStatus().then(grid); }, 4000);
</script>
</body>
</html>`;
