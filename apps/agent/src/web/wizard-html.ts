// 설치 마법사 웹 UI(정적 HTML 문자열). 에이전트 로컬 웹서버가 127.0.0.1 에서 이걸 서빙하고,
// 화면의 버튼들은 같은 서버의 /api/* 엔드포인트를 호출해 기존 CLI 로직(pair/add/login/accounts)을 실행한다.
// ★비개발자 대상: 터미널 0, 클릭만. 채널 세션은 이 컴퓨터에만 저장(서버로 안 감).
// ★한 채널에 여러 계정: 채널 카드마다 계정(라벨)을 N개 추가할 수 있다(엔진·연결DB가 라벨로 분리 지원).

export const WIZARD_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>계정 연결 마법사</title>
<style>
  :root { --ink:#1c1b22; --ink2:#5b5966; --muted:#8a8794; --line:#e7e5ee; --bg:#f6f5fb; --card:#fff; --primary:#4f46e5; --on-primary:#fff; --ok-bg:#e7f6ef; --ok:#0f7a52; --warn-bg:#fdf3e3; --warn:#9a6800; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Apple SD Gothic Neo",sans-serif; background:var(--bg); color:var(--ink); }
  .wrap { max-width:600px; margin:0 auto; padding:40px 20px; }
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
  input[type=text] { flex:1; height:40px; border:1px solid var(--line); border-radius:9px; padding:0 12px; font-size:15px; font-family:inherit; }
  input[type=text]:focus { outline:none; border-color:var(--primary); }
  button { height:40px; padding:0 16px; border-radius:9px; border:1px solid var(--line); background:var(--card); color:var(--ink); font-size:14px; font-weight:500; cursor:pointer; font-family:inherit; }
  button:hover { background:var(--bg); }
  button.primary { background:var(--primary); color:var(--on-primary); border-color:transparent; }
  button.primary:hover { filter:brightness(1.05); }
  button:disabled { opacity:.5; cursor:default; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:12px; }
  .ch { border:1px solid var(--line); border-radius:12px; padding:14px; }
  .ch.on { border-color:var(--ok); }
  .ch .top { display:flex; align-items:center; gap:10px; }
  .ch .ic { width:34px; height:34px; border-radius:8px; background:var(--bg); display:flex; align-items:center; justify-content:center; font-size:18px; }
  .ch .nm { font-weight:600; font-size:14px; }
  .ch .hw { font-size:12px; color:var(--muted); }
  .accts { margin-top:10px; display:flex; flex-direction:column; gap:6px; }
  .acct { display:flex; align-items:center; justify-content:space-between; gap:8px; background:var(--bg); border-radius:8px; padding:7px 10px; }
  .acct .ann { font-size:13px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .acct-r { display:flex; align-items:center; gap:6px; }
  .del { height:24px; width:24px; padding:0; border-radius:6px; border:1px solid var(--line); background:var(--card); color:var(--muted); font-size:12px; line-height:1; display:flex; align-items:center; justify-content:center; }
  .del:hover { border-color:#c0392b; color:#c0392b; background:var(--card); }
  .badge { font-size:12px; padding:3px 9px; border-radius:20px; background:var(--bg); color:var(--muted); white-space:nowrap; }
  .badge.ok { background:var(--ok-bg); color:var(--ok); }
  .badge.warn { background:var(--warn-bg); color:var(--warn); }
  .note { font-size:12px; color:var(--warn); margin-top:8px; line-height:1.5; }
  .addrow { display:flex; gap:8px; margin-top:10px; }
  .addrow input { height:36px; }
  .addbtn { width:100%; margin-top:10px; background:transparent; border:1px dashed var(--line); color:var(--ink2); font-weight:400; }
  .addbtn:hover { border-color:var(--primary); color:var(--primary); background:transparent; }
  .foot { display:flex; justify-content:space-between; align-items:center; margin-top:22px; padding-top:16px; border-top:1px solid var(--line); }
  .hint { font-size:13px; color:var(--muted); }
  .link { color:var(--primary); text-decoration:none; font-size:13px; }
  .sec { font-size:12px; color:var(--muted); margin-top:12px; line-height:1.6; }
  .done-ic { width:54px; height:54px; border-radius:50%; background:var(--ok-bg); color:var(--ok); display:flex; align-items:center; justify-content:center; font-size:30px; margin:0 auto 12px; }
  .pill { display:inline-flex; align-items:center; gap:6px; font-size:13px; background:var(--bg); border:1px solid var(--line); border-radius:20px; padding:4px 11px; margin:0 6px 6px 0; }
  .pill small { color:var(--muted); }
  .panel { margin-top:10px; border:1px solid var(--line); border-radius:10px; padding:12px; background:var(--bg); }
  .phint { font-size:12px; color:var(--ink2); line-height:1.5; margin-bottom:8px; }
  .panel .addrow { margin-top:0; }
  .cancel { width:100%; margin-top:10px; height:34px; background:transparent; border:1px solid var(--line); color:var(--muted); font-weight:400; }
  .cancel:hover { background:var(--card); }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><div class="logo"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div><b>계정 연결 마법사</b></div>
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
// 채널 아이콘 = CRM(buyer-crm)의 ChannelLogo와 동일한 인라인 SVG 글리프 + 브랜드 색.
// (이모지 대신 실제 로고로 한눈에 알아보게. 경로/색은 bpd src/features/crm-views/channel.tsx 단일 출처와 일치.)
var CH={
  whatsapp:{nm:"WhatsApp",ic:"<svg viewBox='0 0 24 24' width='20' height='20' fill='#25a766'><path d='M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2Zm5.4 14.2c-.2.6-1.2 1.1-1.7 1.2-.4.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.5-2.6-1.1-4.3-3.8-4.4-4-.1-.2-1-1.4-1-2.6 0-1.2.6-1.8.9-2.1.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.7 1.8c.1.1.1.3 0 .5l-.3.4-.3.3c-.1.1-.3.3-.1.5.1.3.6 1 1.3 1.6.9.8 1.6 1 1.9 1.2.2.1.4.1.5-.1l.6-.8c.2-.2.3-.2.6-.1l1.7.8c.2.1.4.2.5.3.1.2.1.7-.2 1.4Z'/></svg>",hw:"QR 스캔",note:"폰 → 설정 → 연결된 기기 → 화면의 QR 스캔"},
  alibaba:{nm:"Alibaba",ic:"<svg viewBox='0 0 24 24' width='20' height='20' fill='#ff6a00'><path d='M14.391 16.22c-.963.044-.865-.459-.302-1.234 1.32-1.768 3.82-4.236 3.906-5.982.151-2.283-2.143-3.026-4.501-3.004-1.645.022-3.344.492-4.501.906C5 8.315 2.489 10.576.909 13.076-.768 15.554-.216 17.923 3.322 18c2.716-.109 4.48-.862 6.32-1.802.01 0-5.086 1.453-6.958.383l-.008-.002c-.193-.11-.404-.264-.457-.683-.012-.885 1.46-1.802 2.283-2.097v-1.533a5.374 5.374 0 0 0 1.955.366 5.378 5.378 0 0 0 3.472-1.265c.037.13.056.278.044.447h.371c.048-.394-.172-.706-.172-.706-.333-.529-.915-.52-.915-.52s.315.137.529.466a4.953 4.953 0 0 1-4.665.932l1.21-1.2-.336-.874c2.435-.852 4.48-1.507 7.812-2.085l-.746-.624.389-.24c2.01.568 3.325.985 3.253 2.051a2.672 2.672 0 0 1-.202.611c-.584 1.158-2.326 3.09-3.029 3.898-.465.535-.92 1.06-1.245 1.562-.335.503-.54.971-.551 1.42.043 3.504 10.334-1.64 12.324-3.003-2.943 1.266-6.113 2.489-9.609 2.718Z'/></svg>",hw:"로그인 창",note:"열린 창에서 평소처럼 로그인하세요"},
  instagram:{nm:"Instagram",ic:"<svg viewBox='0 0 24 24' width='20' height='20' fill='#c13584'><path d='M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9a5.5 5.5 0 0 1-5.5 5.5h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2Zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4h-9ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm5.3-2.8a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z'/></svg>",hw:"로그인 창",note:"열린 창에서 로그인하세요"},
  telegram:{nm:"Telegram",ic:"<svg viewBox='0 0 24 24' width='20' height='20' fill='#2aabee'><path d='M21.9 4.3 2.8 11.7c-1 .4-1 1 0 1.3l4.8 1.5L19 7.1c.5-.3 1-.2.6.2l-9.2 8.3-.3 4.4c.4 0 .6-.2.8-.4l2-1.9 4.1 3c.8.4 1.3.2 1.5-.7l2.7-12.7c.3-1.1-.4-1.6-1.3-1Z'/></svg>",hw:"전화 코드",note:"전화번호 입력 → 받은 코드 입력"},
  email:{nm:"Email",ic:"<svg viewBox='0 0 24 24' width='20' height='20' fill='#6b7280'><path d='M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1.4 2L12 12l7.6-5H4.4ZM20 8.3l-8 5.3-8-5.3V17h16V8.3Z'/></svg>",hw:"Gmail 로그인",note:"열린 구글 탭에서 승인하세요"}
};
// 채널별 웹 로그인 방식: window=창(alibaba/instagram) / qr=WhatsApp QR / phone=Telegram 전화+코드 / oauth=구글 승인(email).
var FLOW={alibaba:"window",instagram:"window",whatsapp:"qr",telegram:"phone",email:"oauth"};
// serverConnect = 서버가 준 창-로그인(alibaba/instagram) 진행 상태(connecting/done/error). grid()가 배지로 표시.
var st={step:0,paired:false,accounts:[],connecting:{},adding:{},panel:null,serverConnect:{}};
// panel = {ch, label, mode} — 현재 열려있는 로그인 패널(qr 또는 phone/code). 폴링 타이머는 panelTimer.
var panelTimer=null;

function api(path,body){ return fetch(path,{method:body?"POST":"GET",headers:{"content-type":"application/json"},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json()}); }
function $(id){return document.getElementById(id);}
function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); }
function acctsOf(ch){ return st.accounts.filter(function(a){return a.channel===ch}); }
function ckey(ch,label){ return ch+"\\u0000"+label; }
function totalAccounts(){ return st.accounts.length; }

function loadStatus(){ return api("/api/status").then(function(s){ st.paired=!!s.paired; st.accounts=s.accounts||[]; st.serverConnect=s.connecting||{}; }); }
// 서버가 준 계정별 로그인 상태 키(server.ts connectKey 와 동일: "채널 라벨").
function sckey(ch,label){ return ch+" "+label; }

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
      b.innerHTML='<h2>계정 연결됨</h2><p class="sub">이 컴퓨터가 QualiFlow workspace에 연결됐습니다. 다음으로 진행하세요.</p><span class="badge ok">\\u2713 연결됨</span>';
    } else {
      b.innerHTML='<h2>QualiFlow workspace에 연결</h2><p class="sub">QualiFlow 웹에서 연결 코드를 받아 아래에 붙여넣으세요. 한 번만 하면 됩니다.</p>'
        +'<div class="row"><input id="code" type="text" placeholder="XXXX-XXXX" autocomplete="off" /><button class="primary" id="pair">연결</button></div>'
        +'<div style="margin-top:10px"><a class="link" id="getcode" href="#">대시보드에서 코드 받기 \\u2197</a> <span id="perr" style="color:#c0392b;font-size:13px;margin-left:8px"></span></div>'
        +'<div class="sec">\\uD83D\\uDD12 채널 로그인·세션은 이 컴퓨터에만 저장되고 서버로 가지 않습니다.</div>';
    }
    $("hint").textContent=st.paired?"연결됨 — 다음으로":"";
  } else if(st.step===1){
    b.innerHTML='<h2>채널 연결</h2><p class="sub">한 채널에 여러 계정을 붙일 수 있습니다. 채널의 <b>계정 추가</b>를 누르고 이름을 정한 뒤 로그인하세요.</p><div class="grid" id="grid"></div>';
    grid();
    var n=totalAccounts();
    $("hint").textContent=n>0?(n+"개 계정 연결됨"):"최소 1개를 연결하세요";
  } else {
    b.innerHTML='<div style="text-align:center;padding:10px 0 4px"><div class="done-ic">\\u2713</div>'
      +'<h2 style="text-align:center">준비 완료</h2>'
      +'<p class="sub" style="text-align:center;max-width:380px;margin:0 auto 4px">이제 대시보드에 메시지가 실시간으로 들어옵니다. 이 창은 닫아도 백그라운드에서 계속 동기화됩니다.</p></div>'
      +'<div style="background:var(--bg);border-radius:12px;padding:14px;margin-top:14px"><div style="font-size:12px;color:var(--muted);margin-bottom:8px">연결된 계정</div>'
      +(st.accounts.length?st.accounts.map(function(a){return '<span class="pill">'+(CH[a.channel]?CH[a.channel].ic+' '+CH[a.channel].nm:esc(a.channel))+' <small>'+esc(a.label)+'</small></span>'}).join(""):'<span class="hint">아직 없음</span>')+'</div>';
    $("hint").textContent="";
  }
  $("back").style.visibility=st.step===0?"hidden":"visible";
  var nx=$("next");
  nx.textContent=st.step===2?"대시보드 열기":"다음";
  nx.disabled=(st.step===0&&!st.paired);
}

function grid(){
  $("grid").innerHTML=Object.keys(CH).map(function(ch){
    var c=CH[ch], accts=acctsOf(ch);
    var rows=accts.map(function(a){
      // 배지 = 실제 상태. 진행중/실패(서버 connectState) 우선, 그 다음 실제 세션(a.connected).
      // ★핵심: 라벨만 등록되고 로그인 안 됐으면(연결 안 됨) "연결됨"이 아니라 "로그인 필요" 버튼을 보여
      //   준다 — 눌러서 그 라벨로 바로 로그인(startConnect). (예전엔 등록만 돼도 "연결됨"으로 속였다.)
      if(removing[ckey(ch,a.label)]){
        return '<div class="acct"><span class="ann">'+esc(a.label)+'</span><span class="badge warn">삭제 중\\u2026</span></div>';
      }
      var cs=st.serverConnect[sckey(ch,a.label)];
      var badge;
      if(cs&&cs.status==="connecting"){ badge='<span class="badge warn">로그인 창 여는 중\\u2026</span>'; }
      else if(cs&&cs.status==="error"){ badge='<button class="badge warn" data-login="'+ch+'" data-label="'+esc(a.label)+'" style="cursor:pointer" title="'+esc(cs.message||"")+'">로그인 실패 \\u2014 다시 로그인</button>'; }
      else if(a.connected){ badge='<span class="badge ok">\\u2713 연결됨</span>'; }
      else { badge='<button class="badge warn" data-login="'+ch+'" data-label="'+esc(a.label)+'" style="cursor:pointer">로그인 필요 \\u2014 지금 로그인</button>'; }
      var del='<button class="del" data-del-ch="'+ch+'" data-del-label="'+esc(a.label)+'" title="이 계정 연결 삭제">\\u2715</button>';
      return '<div class="acct"><span class="ann">'+esc(a.label)+'</span><span class="acct-r">'+badge+del+'</span></div>';
    });
    var busyNote=false;
    Object.keys(st.connecting).forEach(function(k){
      if(k.indexOf(ch+"\\u0000")===0 && st.connecting[k]==="busy"){
        var lbl=k.split("\\u0000")[1];
        if(!accts.some(function(a){return a.label===lbl})){
          rows.push('<div class="acct"><span class="ann">'+esc(lbl)+'</span><span class="badge warn">연결 중\\u2026</span></div>');
          busyNote=true;
        }
      }
    });
    var panel=panelHtml(ch);
    var adder=panel
      ? ''
      : st.adding[ch]
      ? '<div class="addrow"><input class="lblinput" data-ch="'+ch+'" type="text" placeholder="계정 이름 (예: 회사용)" autocomplete="off" /><button class="primary" data-add="'+ch+'">연결</button></div>'
      : '<button class="addbtn" data-open="'+ch+'">+ 계정 추가</button>';
    return '<div class="ch '+(accts.length?"on":"")+'"><div class="top"><span class="ic">'+c.ic+'</span><div style="flex:1"><div class="nm">'+c.nm+'</div><div class="hw">'+c.hw+'</div></div></div>'
      +(rows.length?'<div class="accts">'+rows.join("")+'</div>':'')
      +(busyNote?'<div class="note">'+c.note+'</div>':'')
      +'<div class="act">'+adder+panel+'</div></div>';
  }).join("");
  var inp=document.querySelector(".lblinput"); if(inp){ inp.focus(); return; }
  var tgp=document.getElementById("tgphone"); if(tgp){ tgp.focus(); return; }
  var tgc=document.getElementById("tgcode"); if(tgc){ tgc.focus(); }
}

function startConnect(ch,rawLabel){
  var accts=acctsOf(ch);
  var label=(rawLabel||"").trim() || (accts.length?"계정"+(accts.length+1):"기본");
  st.adding[ch]=false;
  var flow=FLOW[ch]||"window";
  if(flow==="qr"){ startWhatsApp(ch,label); return; }
  if(flow==="phone"){ openPanel(ch,label,"phone"); return; }
  if(flow==="oauth"){ startEmail(ch,label); return; }
  // window 흐름(alibaba/instagram): 창을 열고 폴링으로 연결 확인.
  var k=ckey(ch,label);
  st.connecting[k]="busy"; grid();
  api("/api/connect",{channel:ch,label:label}).then(function(r){
    st.connecting[k]=r&&r.ok?"done":null;
    if(r&&!r.ok&&r.message){ alert(r.message); }
    return loadStatus();
  }).then(grid).catch(function(){ st.connecting[k]=null; grid(); });
}

// 계정 삭제(로컬만) — 이 컴퓨터의 로그인 세션과 받아둔 대화를 지운다. 대시보드로 보낸 과거 대화는 남는다.
var removing={}; // 삭제 진행 중인 계정(ckey) — 배지를 "삭제 중…"으로 바꾸고 중복 클릭을 막는다.
function removeAccount(ch,label){
  if(!confirm("이 계정 연결을 삭제할까요? 이 컴퓨터의 로그인 세션과 받아둔 대화가 지워집니다. (이미 대시보드로 보낸 과거 대화는 남습니다.)")) return;
  var k=ckey(ch,label);
  if(removing[k]) return;
  removing[k]=true; grid(); // 삭제 중 배지
  api("/api/remove-account",{channel:ch,label:label}).then(function(r){
    if(r&&!r.ok&&r.message){ alert(r.message); }
    delete removing[k];
    return loadStatus();
  }).then(grid).catch(function(){ delete removing[k]; grid(); });
}

// ── Email: 구글 OAuth 승인(loopback) ──
// 서버에서 동의 URL을 받아 새 탭으로 연다. 승인이 끝나면 서버가 /oauth/callback 으로 code를 받아
// 토큰 교환·저장·등록을 하고, connectState 로 done/error 를 표면화 → 4초 상태 폴링이 배지를 갱신한다.
function startEmail(ch,label){
  var k=ckey(ch,label);
  st.connecting[k]="busy"; grid();
  // 팝업 차단 회피: 클릭 흐름 안에서 빈 탭을 먼저 연 뒤, authUrl 이 오면 그 탭을 그 주소로 보낸다.
  var tab=window.open("about:blank","_blank");
  api("/api/connect-email",{channel:ch,label:label}).then(function(r){
    if(r&&r.ok&&r.authUrl){ if(tab){ tab.location.href=r.authUrl; } else { window.open(r.authUrl,"_blank"); } }
    else { st.connecting[k]=null; if(tab){tab.close();} if(r&&r.message){alert(r.message);} grid(); return; }
    return loadStatus();
  }).then(grid).catch(function(){ st.connecting[k]=null; if(tab){tab.close();} grid(); });
}

function stopPanel(){ if(panelTimer){clearInterval(panelTimer);panelTimer=null;} st.panel=null; }

// 로그인 패널을 채널 카드 밑에 인라인으로 그린다. mode: qr | phone | code | done.
function openPanel(ch,label,mode,extra){
  st.panel={ch:ch,label:label,mode:mode,extra:extra||{}}; grid();
}

// ── WhatsApp: QR 폴링 ──
function startWhatsApp(ch,label){
  openPanel(ch,label,"qr",{qr:null,waiting:true});
  api("/api/connect-whatsapp",{label:label}).then(function(r){
    if(r&&!r.ok){ st.panel.extra={error:r.message||"시작 실패"}; grid(); return; }
    pollWaQr(label);
  });
}
function pollWaQr(label){
  if(panelTimer) clearInterval(panelTimer);
  panelTimer=setInterval(function(){
    if(!st.panel||st.panel.mode!=="qr"){ clearInterval(panelTimer); panelTimer=null; return; }
    api("/api/wa-qr?label="+encodeURIComponent(label)).then(function(r){
      if(!st.panel) return;
      if(r.error){ st.panel.extra={error:r.error}; grid(); return; }
      if(r.done){ stopPanel(); loadStatus().then(function(){ render(); }); return; }
      st.panel.extra={qr:r.qr,waiting:!r.qr}; grid();
    });
  },1500);
}
// QR 매트릭스(boolean[][])를 SVG로 그린다. 셀당 6px, 크게 스캔 잘 되게.
function qrSvg(m){
  if(!m||!m.length) return "";
  var n=m.length, cell=6, size=n*cell;
  var rects="";
  for(var r=0;r<n;r++){ for(var c=0;c<m[r].length;c++){ if(m[r][c]){ rects+='<rect x="'+(c*cell)+'" y="'+(r*cell)+'" width="'+cell+'" height="'+cell+'"/>'; } } }
  return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" style="background:#fff"><g fill="#000">'+rects+'</g></svg>';
}

// ── Telegram: 전화 → 코드 ──
function tgSendPhone(label){
  var phone=(document.getElementById("tgphone").value||"").trim();
  if(!phone){ return; }
  st.panel.extra={waiting:true}; grid();
  api("/api/connect-telegram",{label:label,phone:phone}).then(function(r){
    if(r&&!r.ok){ st.panel.extra={error:r.message||"시작 실패"}; grid(); return; }
    pollTgState(label);
  });
}
function tgSendCode(label){
  var code=(document.getElementById("tgcode").value||"").trim();
  if(!code){ return; }
  api("/api/connect-telegram-code",{label:label,code:code}).then(function(r){
    if(r&&!r.ok){ st.panel.extra={error:r.message||"코드 오류"}; grid(); }
  });
}
function pollTgState(label){
  if(panelTimer) clearInterval(panelTimer);
  panelTimer=setInterval(function(){
    if(!st.panel||st.panel.ch!=="telegram"){ clearInterval(panelTimer); panelTimer=null; return; }
    api("/api/tg-state?label="+encodeURIComponent(label)).then(function(r){
      if(!st.panel) return;
      // 코드 오류(만료/오타)는 회복 가능 — 코드 패널에 그대로 머물며 에러만 보여주고 계속 폴링한다
      //   (사용자가 새 코드를 넣으면 그대로 재시도). stage==="error"(2FA 등 회복 불가)만 처음으로 되돌린다.
      if(r.stage==="error"){ st.panel.mode="phone"; st.panel.extra={error:r.error}; grid(); if(panelTimer){clearInterval(panelTimer);panelTimer=null;} return; }
      if(r.stage==="done"){ stopPanel(); loadStatus().then(function(){ render(); }); return; }
      if(r.stage==="code"){
        if(st.panel.mode!=="code"){ st.panel.mode="code"; st.panel.extra={}; }
        // 코드 단계 에러(PHONE_CODE_INVALID 등)를 코드 패널에 인라인 표시. 값이 바뀔 때만 다시 그린다.
        var cur=(st.panel.extra&&st.panel.extra.error)||"";
        if((r.error||"")!==cur){ st.panel.extra={error:r.error||""}; grid(); }
      }
    });
  },1500);
}

// 패널 HTML(채널 카드 하단에 인라인).
function panelHtml(ch){
  if(!st.panel||st.panel.ch!==ch) return "";
  var p=st.panel, e=p.extra||{};
  var err=e.error?'<div class="note" style="color:#c0392b">'+esc(e.error)+'</div>':'';
  if(p.mode==="qr"){
    var body=e.qr?qrSvg(e.qr):'<div class="hint" style="padding:24px 0">QR 준비 중\\u2026</div>';
    return '<div class="panel"><div class="phint">폰 \\u2192 설정 \\u2192 연결된 기기 \\u2192 기기 연결 \\u2192 아래 QR 스캔</div><div style="text-align:center;padding:8px 0">'+body+'</div>'+err+'<button class="cancel" data-cancel="1">취소</button></div>';
  }
  if(p.mode==="phone"){
    return '<div class="panel"><div class="phint">텔레그램 전화번호(국가코드 포함)</div><div class="addrow"><input id="tgphone" type="text" placeholder="+8210xxxxxxxx" autocomplete="off"/><button class="primary" data-tgphone="'+esc(p.label)+'">코드 받기</button></div>'+(e.waiting?'<div class="hint" style="margin-top:8px">코드 요청 중\\u2026</div>':'')+err+'<button class="cancel" data-cancel="1">취소</button></div>';
  }
  if(p.mode==="code"){
    return '<div class="panel"><div class="phint">텔레그램 앱/문자로 받은 코드를 입력</div><div class="addrow"><input id="tgcode" type="text" placeholder="12345" autocomplete="off"/><button class="primary" data-tgcode="'+esc(p.label)+'">확인</button></div>'+err+'<button class="cancel" data-cancel="1">취소</button></div>';
  }
  return "";
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
  if(t.dataset.open){ st.adding[t.dataset.open]=true; grid(); return; }
  if(t.dataset.add){ var ch=t.dataset.add; var inp=document.querySelector('.lblinput[data-ch="'+ch+'"]'); startConnect(ch, inp?inp.value:""); return; }
  if(t.dataset.login){ startConnect(t.dataset.login, t.dataset.label||""); return; }
  if(t.dataset.delCh){ removeAccount(t.dataset.delCh, t.dataset.delLabel||""); return; }
  if(t.dataset.tgphone){ tgSendPhone(t.dataset.tgphone); return; }
  if(t.dataset.tgcode){ tgSendCode(t.dataset.tgcode); return; }
  if(t.dataset.cancel){ stopPanel(); grid(); return; }
});
document.addEventListener("keydown",function(e){
  if(e.key!=="Enter") return;
  var cl=e.target.classList;
  if(cl && cl.contains("lblinput")){ startConnect(e.target.dataset.ch, e.target.value); return; }
  if(e.target.id==="tgphone" && st.panel){ tgSendPhone(st.panel.label); return; }
  if(e.target.id==="tgcode" && st.panel){ tgSendCode(st.panel.label); return; }
});

loadStatus().then(function(){
  // 웹 "채널 추가" 버튼은 ?add=1 로 연다. 이미 페어링돼 있으면 채널 단계로 바로 진입(딸깍 한 번 절약).
  try { if(new URLSearchParams(location.search).get("add")==="1" && st.paired) st.step=1; } catch(e){}
  render();
}).catch(function(){ render(); });
// 채널 단계에서 계정 목록을 주기적으로 새로고침. 단, 로그인 패널이 열려 있거나(입력칸/QR이 매
// 폴링마다 다시 그려져 포커스가 튀는 걸 막음 — 패널은 자체 타이머로 갱신) 계정 이름을 입력하는
// 중(st.adding)이면 그리지 않는다 — grid()가 .lblinput 을 새로 만들어 타이핑 중인 값·포커스가
// 날아가는 걸 막는다. 사용자가 "연결"을 누르면(st.adding=false) 다음 폴링부터 정상 갱신된다.
function isAdding(){ return Object.keys(st.adding).some(function(ch){return st.adding[ch]}); }
setInterval(function(){ if(st.step===1 && !st.panel && !isAdding()) loadStatus().then(grid); }, 4000);
</script>
</body>
</html>`;
