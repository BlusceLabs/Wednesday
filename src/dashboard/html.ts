export const dashboardHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wednesday</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#1a1712;
  --panel:#221e17;
  --panel2:#2a251c;
  --line:#3c3626;
  --text:#f3ede0;
  --muted:#9b998a;
  --mustard:#e3a83c;
  --mustard-dim:#b9852c;
  --jungle:#376b4f;
  --jungle-light:#5a9c78;
  --cactus:#8a9488;
  --rust:#bb5138;
  --font-display:'Fraunces',Georgia,serif;
  --font-body:'Inter',ui-sans-serif,system-ui;
  --font-mono:'JetBrains Mono',ui-monospace,monospace;
}
*{box-sizing:border-box}
/* Hide scrollbars everywhere for a cleaner console feel, while keeping
   scroll behavior intact (chat auto-scrolls to the latest message). */
html{scrollbar-width:none;-ms-overflow-style:none}
*{scrollbar-width:none}
*::-webkit-scrollbar{width:0;height:0;display:none}
body{margin:0;background:
  radial-gradient(ellipse 900px 500px at 85% -8%,#2c3d2c66 0,transparent 55%),
  radial-gradient(ellipse 700px 400px at -5% 15%,#4a381566 0,transparent 50%),
  var(--bg);
  color:var(--text);font:14px var(--font-body);min-height:100vh}
.shell{display:grid;grid-template-columns:252px 1fr;min-height:100vh;transition:grid-template-columns .22s ease}
.shell.collapsed{grid-template-columns:76px 1fr}
.side{position:relative;border-right:1px solid var(--line);padding:24px 20px;background:#1a170fcc;display:flex;flex-direction:column;overflow:hidden;width:252px;transition:width .22s ease,padding .22s ease}
.side.collapsed{width:76px;padding:24px 12px}
.contour{position:absolute;inset:0;opacity:.16;pointer-events:none}
.sidetop{display:flex;align-items:center;justify-content:space-between;position:relative;gap:8px}
.side.collapsed .sidetop{flex-direction:column;gap:12px}
.brand{font:600 22px var(--font-display);letter-spacing:.2px;display:flex;align-items:baseline;gap:2px;overflow:hidden;white-space:nowrap}
.brand i{color:var(--mustard);font-style:normal;font-weight:700}
.collapse-btn{width:26px;height:26px;border-radius:50%;background:var(--panel2);border:1px solid var(--line);color:var(--cactus);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:transform .22s ease,color .15s;font-size:13px}
.collapse-btn:hover{color:var(--text)}
.side.collapsed .collapse-btn{transform:rotate(180deg)}
.sub{color:var(--muted);margin:5px 0 30px;position:relative;white-space:nowrap;overflow:hidden}
.nav{display:grid;gap:6px;position:relative}
.navdivider{height:1px;background:var(--line);margin:10px 2px}
.nav button{display:flex;align-items:center;gap:10px;background:transparent;color:var(--muted);border:0;border-left:2px solid transparent;text-align:left;padding:11px 12px;border-radius:0 8px 8px 0;cursor:pointer;font-size:14px;font-family:var(--font-body);transition:background .15s,color .15s;white-space:nowrap;overflow:hidden;width:100%}
.nav button.active{background:#2a2519;color:var(--text);border-left:2px solid var(--jungle-light)}
.nav button:hover{background:#241f16;color:var(--text)}
.navicon{flex-shrink:0;font-size:15px;width:18px;text-align:center}
.side.collapsed .nav button{justify-content:center;padding:11px 0}
.side.collapsed .fade-text{display:none}
.sidefoot{margin-top:auto;padding-top:22px;position:relative}
.token{width:100%;background:#15130d;border:1px solid var(--line);color:var(--text);padding:10px;border-radius:8px;font-family:var(--font-mono);font-size:12px}
.token::placeholder{color:var(--muted)}
.main{padding:28px;max-width:1440px;width:100%;margin:auto}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.top h1{font:600 26px var(--font-display);margin:0}
.sub2{color:var(--muted);margin:6px 0 0}
.status{color:var(--jungle-light);display:flex;align-items:center;gap:8px;font-weight:600;font-family:var(--font-mono);font-size:12px;text-transform:uppercase;letter-spacing:.08em}
.statusrow{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
.statuspill{display:flex;align-items:center;gap:9px;background:linear-gradient(160deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:10px;padding:9px 14px;font-family:var(--font-mono);font-size:12px}
.statuspill .k{color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:10px}
.statuspill .v{color:var(--text);font-weight:600}
.statuspill .v.model{color:var(--mustard)}
.meter{position:relative;width:84px;height:7px;border-radius:6px;background:#15130d;overflow:hidden}
.meter .fill{height:100%;border-radius:6px;background:linear-gradient(90deg,var(--jungle-light),var(--mustard))}
.dot{width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 14px currentColor;animation:pulse 2.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.78)}}
.viewhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.viewhead h2{font:600 16px var(--font-display);margin:0;color:var(--text)}
.linkbtn{background:transparent;border:0;color:var(--muted);font-size:12px;font-family:var(--font-mono);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.linkbtn:hover{color:var(--text)}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:18px}
.card{background:linear-gradient(160deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:14px 14px 6px 14px;padding:18px}
.metric{font:700 26px var(--font-display);margin-top:8px}
.label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.12em;font-family:var(--font-mono)}
.view.hidden{display:none!important}
.charts-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;margin-bottom:18px}
.chart-card .toprow{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px}
.chart-card .toprow strong{font:600 15px var(--font-display)}
.linechart{width:100%;min-height:150px}
.linechart svg{width:100%;height:150px;display:block;overflow:visible}
.axis-label{font-size:10px;fill:var(--muted);font-family:'JetBrains Mono',monospace}
.modelbar{margin-bottom:16px}
.modelbar:last-child{margin-bottom:0}
.modelrow{display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px}
.modelrow .mname{color:var(--text);font-weight:500;font-family:var(--font-mono)}
.modelrow .mval{color:var(--muted);font-family:var(--font-mono);font-size:12px}
.track{height:8px;border-radius:6px;background:#15130d;overflow:hidden}
.fill{height:100%;border-radius:6px}
.catgrid{display:grid;gap:10px}
.catrow{display:grid;grid-template-columns:140px 1fr 34px;align-items:center;gap:10px;font-size:12px}
.catrow .cname{color:var(--cactus);font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.catrow .cnum{color:var(--muted);text-align:right;font-family:var(--font-mono)}
.footnote{color:var(--muted);font-size:11px;margin-top:14px;font-family:var(--font-mono)}
.empty-state{color:var(--muted);font-size:12.5px;padding:34px 10px;text-align:center;font-family:var(--font-mono);border:1px dashed var(--line);border-radius:10px}
.audit-controls{display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap}
.audit-controls .spacer{flex:1}
switch.audit-toggle{position:relative;display:inline-flex;align-items:center;gap:8px;color:var(--muted);font-size:12px;font-family:var(--font-mono);cursor:pointer;user-select:none}
switch.audit-toggle input{appearance:none;width:34px;height:18px;border-radius:20px;background:#15130d;border:1px solid var(--line);position:relative;cursor:pointer;transition:background .15s;margin:0}
switch.audit-toggle input:checked{background:#1c2b21;border-color:#33503f}
switch.audit-toggle input::after{content:'';position:absolute;top:1px;left:1px;width:14px;height:14px;border-radius:50%;background:var(--cactus);transition:transform .15s,background .15s}
switch.audit-toggle input:checked::after{transform:translateX(16px);background:var(--jungle-light)}
#auditList{display:grid;gap:8px;max-height:calc(100vh - 290px);overflow:auto}
.audit{display:grid;grid-template-columns:18px 1fr auto;gap:12px;align-items:start;padding:11px 14px;border:1px solid var(--line);border-radius:10px;background:#1e1b13}
.audit .glyph{width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;margin-top:1px}
.audit .glyph.user{background:#241c0d;color:var(--mustard);border:1px solid var(--mustard-dim)}
.audit .glyph.wednesday{background:#1c2b21;color:var(--jungle-light);border:1px solid #33503f}
.audit .glyph.system{background:#241f16;color:var(--cactus);border:1px solid var(--line)}
.audit .glyph.tool{background:#2a1f12;color:var(--rust);border:1px solid #5a331f}
.audit .body{min-width:0}
.audit .row1{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.audit .etype{font:600 13px var(--font-body);color:var(--text)}
.audit .actor{font-size:11px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.audit .detail{color:var(--cactus);font-size:12px;font-family:var(--font-mono);margin-top:4px;white-space:pre-wrap;word-break:break-word}
.audit .time{color:var(--muted);font-size:11px;font-family:var(--font-mono);white-space:nowrap;flex-shrink:0}
.audit .hash{color:var(--line);font-size:10px;font-family:var(--font-mono);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.memory-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}
.memory-grid .card .metric{font:700 24px var(--font-display);margin-top:6px}
.memory-sub{display:grid;grid-template-columns:1.3fr .7fr;gap:18px;margin-bottom:18px}
.membar{margin-bottom:12px}.membar:last-child{margin-bottom:0}
.tagcloud{display:flex;flex-wrap:wrap;gap:8px}
.tag{font-size:12px;color:var(--cactus);background:#1c2b21;border:1px solid #33503f;padding:4px 11px;border-radius:20px;font-family:var(--font-mono)}
.tag b{color:var(--jungle-light);font-weight:600;margin-left:6px}
.mem-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px}
.mem-actions .import-path{flex:1;min-width:200px;background:#15130d;border:1px solid var(--line);color:var(--text);padding:10px;border-radius:8px;font-size:13px;font-family:var(--font-body)}
.mem-actions .import-path::placeholder{color:var(--muted)}
.btn.ghost{background:#241f16;color:var(--muted);border:1px solid var(--line)}
.btn.ghost:hover{color:var(--text)}
.memnote{color:var(--muted);font-size:12px;margin-top:12px;font-family:var(--font-mono)}
.models .provhead{display:flex;align-items:center;gap:10px;margin:18px 0 10px}.models .provhead:first-child{margin-top:0}.models .provname{font:600 14px var(--font-body);color:var(--text)}.models .provapi{color:var(--muted);font-size:11px;font-family:var(--font-mono)}
.modellist{display:grid;gap:8px}
.modelrow{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:#1e1b13}
.modelrow.active{border-color:var(--jungle-light);background:#1c2b21}
.modelrow .mname{font-weight:600;font-size:14px;display:flex;align-items:center;gap:9px}
.modelrow .badge{font-size:10px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--jungle-light);background:#10231a;border:1px solid #33503f;padding:2px 8px;border-radius:20px}
.modelrow .mmeta{color:var(--muted);font-size:12px;font-family:var(--font-mono);margin-top:4px;display:flex;gap:12px;flex-wrap:wrap}
.modelrow .mtags{display:flex;gap:6px;margin-top:6px}.modelrow .mtag{font-size:10px;font-family:var(--font-mono);color:var(--cactus);background:#241f16;border:1px solid var(--line);padding:1px 7px;border-radius:20px}
.models .usemodel{background:transparent;border:1px solid var(--line);color:var(--muted);font-size:12px;font-family:var(--font-mono);padding:7px 14px;border-radius:8px;cursor:pointer;flex-shrink:0}.models .usemodel:hover{color:var(--text);border-color:var(--jungle-light)}.models .usemodel:disabled{opacity:.4;cursor:default}
.effortrow{display:flex;align-items:center;gap:6px;margin-top:9px;flex-wrap:wrap}.effortrow .elabel{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-family:var(--font-mono);margin-right:2px}.effortbtn{background:transparent;border:1px solid var(--line);color:var(--muted);font-size:11px;font-family:var(--font-mono);padding:4px 10px;border-radius:7px;cursor:pointer}.effortbtn:hover{color:var(--text);border-color:var(--jungle-light)}.effortbtn.active{color:var(--jungle-light);border-color:var(--jungle-light);background:#10231a}.effortbtn:disabled{opacity:.5;cursor:default}
.skills .skillrow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--line);border-radius:9px;background:#1e1b13;cursor:pointer;transition:border-color .15s}
.skills .skillrow:hover{border-color:var(--jungle-light)}
.skills .skillrow strong{font-size:13px;font-family:var(--font-body)}
.skills .skillrow .v{color:var(--muted);font-size:11px;font-family:var(--font-mono);margin-left:6px}
.skills .skillrow small{display:block;color:var(--muted);font-size:12px;margin-top:2px}
.skills .skillbody{margin:-1px 0 8px;padding:12px 14px;border:1px solid var(--line);border-top:none;border-radius:0 0 9px 9px;background:#15130d;white-space:pre-wrap;font-family:var(--font-mono);font-size:12px;color:var(--cactus);max-height:380px;overflow:auto}
.grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr);gap:18px}
.chat-pane{display:flex;flex-direction:column;height:calc(100vh - 210px);min-height:480px}
.chathead{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;margin-bottom:12px;border-bottom:1px solid var(--line)}
.messages{flex:1;overflow:auto;scroll-behavior:smooth;padding:6px 4px 10px;display:flex;flex-direction:column;gap:20px;max-width:760px;width:100%;margin:0 auto}
.msg{max-width:84%;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.msg.you{margin-left:auto;background:linear-gradient(150deg,#3a2f14,#2c2210);border:1px solid var(--mustard-dim);color:#fbeed4;padding:12px 16px;border-radius:20px 20px 4px 20px}
.msg.sys{background:transparent;border:1px dashed var(--line);color:var(--mustard);max-width:100%;font-size:13px;font-family:var(--font-mono);padding:10px 14px;border-radius:10px}
.msg.wed{display:flex;gap:12px;align-items:flex-start;max-width:100%}
.avatar{width:28px;height:28px;border-radius:50%;background:linear-gradient(150deg,var(--jungle-light),var(--jungle));display:flex;align-items:center;justify-content:center;font:700 13px var(--font-display);color:#0e1a13;flex-shrink:0;margin-top:2px}
.msg-content{flex:1;min-width:0}
.thinking{margin-top:10px;border-left:2px solid var(--jungle);padding:4px 10px;color:var(--cactus);font-size:13px;white-space:pre-wrap;font-family:var(--font-mono)}
.thinking summary{cursor:pointer;color:var(--muted);list-style:none;user-select:none}
.thinking summary::-webkit-details-marker{display:none}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.chip{font-size:12px;color:var(--jungle-light);background:#1c2b21;border:1px solid #33503f;padding:3px 9px;border-radius:20px;font-family:var(--font-mono)}
.typing{display:inline-flex;gap:4px;padding:6px 4px}
.typing span{width:7px;height:7px;border-radius:50%;background:var(--muted);animation:blink 1.2s infinite both}
.typing span:nth-child(2){animation-delay:.2s}
.typing span:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.25}40%{opacity:1}}
.tooltag{display:inline-block;margin-top:8px;font-size:12px;color:var(--mustard);background:#241c0d;border:1px solid var(--mustard-dim);border-radius:6px;padding:2px 8px;font-family:var(--font-mono)}
.composer{display:flex;gap:6px;margin-top:14px;background:var(--panel2);border:1px solid var(--line);border-radius:26px;padding:6px 6px 6px 20px;align-items:center;max-width:760px;width:100%;margin-left:auto;margin-right:auto}
.composer input{flex:1;background:transparent;border:0;color:var(--text);padding:10px 4px;font-size:14px;font-family:var(--font-body)}
.composer input::placeholder{color:var(--muted)}
.composer input:focus{outline:none}
.composer input:disabled{opacity:.5}
.send{width:40px;height:40px;border-radius:50%;background:linear-gradient(150deg,var(--jungle-light),var(--jungle));color:#0e1a13;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;flex-shrink:0}
.send:disabled{opacity:.4;cursor:default}
.tools .toolhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.search{width:100%;background:#15130d;border:1px solid var(--line);color:var(--text);padding:10px;border-radius:8px;margin-bottom:12px;font-size:13px;font-family:var(--font-body)}
#toolList{display:grid;gap:8px;max-height:calc(100vh - 320px);overflow:auto}
.tool{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:#1e1b13}
.tool strong{font-size:13px;font-family:var(--font-body)}
.tool small{color:var(--muted)}
.pill{font-size:11px;padding:3px 9px;border-radius:20px;color:var(--cactus);background:#242018;font-family:var(--font-mono)}
.approvalmodal{position:fixed;inset:0;background:#0c0a06f2;display:grid;place-items:center;z-index:50}
.approvalbox{width:min(560px,92vw);background:linear-gradient(160deg,var(--panel2),var(--panel));border:1px solid var(--mustard);border-radius:16px 16px 6px 16px;padding:24px}
.approvalbox h2{margin:10px 0 14px;font:600 19px var(--font-display)}
.approvalbox pre{background:#15130d;border:1px solid var(--line);border-radius:8px;padding:12px;max-height:200px;overflow:auto;color:var(--cactus);font-size:12px;white-space:pre-wrap;margin:0;font-family:var(--font-mono)}
.approvalactions{display:flex;gap:10px;margin-top:18px;justify-content:flex-end}
.btn{border:0;padding:10px 18px;border-radius:9px;font-weight:700;cursor:pointer;font-family:var(--font-body)}
.btn.allow{background:linear-gradient(150deg,var(--jungle-light),var(--jungle));color:#0e1a13}
.btn.deny{background:#241f16;color:var(--muted);border:1px solid var(--line)}
.hidden{display:none!important}
@media (max-width:980px){
  .stats{grid-template-columns:repeat(2,1fr)}
  .charts-grid{grid-template-columns:1fr}
}
@media (max-width:820px){
  .shell{grid-template-columns:76px 1fr}
  .side{width:76px;padding:24px 12px}
  .side .fade-text{display:none}
  .side .sidetop{flex-direction:column;gap:12px}
  .nav button{justify-content:center;padding:11px 0}
  .collapse-btn{display:none}
}
</style></head><body><div class="shell" id="shell"><aside class="side" id="sidebar">
<svg class="contour" viewBox="0 0 260 700" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
<path d="M-20 60 C 60 20, 140 90, 280 40" stroke="#5a9c78" stroke-width="1" fill="none"/>
<path d="M-20 90 C 60 50, 140 120, 280 70" stroke="#5a9c78" stroke-width="1" fill="none"/>
<path d="M-20 120 C 60 80, 140 150, 280 100" stroke="#5a9c78" stroke-width="1" fill="none"/>
<path d="M-20 620 C 80 660, 160 590, 280 650" stroke="#e3a83c" stroke-width="1" fill="none"/>
<path d="M-20 650 C 80 690, 160 620, 280 680" stroke="#e3a83c" stroke-width="1" fill="none"/>
</svg>
<div class="sidetop"><div class="brand"><i>W</i><span class="fade-text">ednesday</span></div><button class="collapse-btn" id="collapseBtn" onclick="toggleSidebar()" aria-label="Collapse sidebar" title="Collapse sidebar">‹</button></div>
<div class="sub fade-text">Personal agent console</div>
<div class="nav">
<button class="active" data-view="overview" onclick="selectView(this,'overview')"><span class="navicon">◧</span><span class="fade-text">Overview</span></button>
<button data-view="chat" onclick="selectView(this,'chat')"><span class="navicon">◆</span><span class="fade-text">Chat</span></button>
<button data-view="tools" onclick="selectView(this,'tools')"><span class="navicon">◫</span><span class="fade-text">Tool registry</span></button>
<button data-view="audit" onclick="selectView(this,'audit')"><span class="navicon">◰</span><span class="fade-text">Audit log</span></button>
<button data-view="memory" onclick="selectView(this,'memory')"><span class="navicon">❖</span><span class="fade-text">Memory</span></button>
<button data-view="models" onclick="selectView(this,'models')"><span class="navicon">◈</span><span class="fade-text">Models</span></button>
<button data-view="skills" onclick="selectView(this,'skills')"><span class="navicon">✶</span><span class="fade-text">Skills</span></button>
<div class="navdivider"></div>
<button onclick="clearSession()"><span class="navicon">⟲</span><span class="fade-text">Clear session</span></button>
<button onclick="toggleHelp()"><span class="navicon">⌘</span><span class="fade-text">Keyboard &amp; commands</span></button>
</div>
<div class="sidefoot fade-text"><div class="label" style="margin-bottom:8px">Bearer token</div><input id="token" class="token" type="password" placeholder="Localhost: optional"></div>
</aside><main class="main">
<div class="top"><div><h1>Good to see you.</h1><div class="sub2">Wednesday is ready to work.</div></div><div class="status"><span class="dot"></span><span id="health">connecting</span></div></div>

<div id="view-overview" class="view">
<div class="statusrow" id="statusRow"><span class="statuspill"><span class="k">Active model</span><span class="v model" id="statModel">—</span></span><span class="statuspill"><span class="k">Context</span><span class="meter"><span class="fill" id="statContextFill" style="width:0%"></span></span><span class="v" id="statContext">—</span></span><span class="statuspill"><span class="k">Cache hits</span><span class="v" id="statCache">—</span></span></div>
<section class="stats">
<div class="card"><div class="label">Available tools</div><div class="metric" id="toolCount">—</div></div>
<div class="card"><div class="label">Tool groups</div><div class="metric" id="groupCount">—</div></div>
<div class="card"><div class="label">Session messages</div><div class="metric" id="messageCount">—</div></div>
<div class="card"><div class="label">Tokens today</div><div class="metric" id="tokensToday" style="color:var(--mustard)">—</div></div>
<div class="card"><div class="label">Safety</div><div class="metric" style="color:var(--jungle-light)">Active</div></div>
</section>
<div class="viewhead"><h2>This session</h2><button class="linkbtn" onclick="resetUsage()">Reset usage data</button></div>
<section class="charts-grid">
<div class="card chart-card">
<div class="toprow"><strong>Tokens per turn</strong><span class="label" id="tokenWeekTotal">—</span></div>
<div class="linechart" id="tokenChart"></div>
<div class="footnote" id="tokenFoot">Populates from live response usage.</div>
</div>
<div class="card chart-card">
<div class="toprow"><strong>Models used</strong><span class="label">this session</span></div>
<div id="modelBars"></div>
<div class="footnote" id="modelFoot">Populates from live response usage.</div>
</div>
</section>
<section class="charts-grid">
<div class="card chart-card">
<div class="toprow"><strong>Tool calls this session</strong><span class="label" id="toolCallTotal">0</span></div>
<div class="catgrid" id="toolCallBars"></div>
</div>
<div class="card chart-card">
<div class="toprow"><strong>Tool registry by category</strong><span class="label" id="catTotal">—</span></div>
<div class="catgrid" id="categoryBars"></div>
</div>
</section>
</div>

<div id="view-chat" class="view hidden">
<div class="chat-pane"><div class="chathead"><div class="label">Conversation</div><button class="btn deny" style="padding:4px 12px;font-size:12px" onclick="clearSession()">Clear</button></div><div id="messages" class="messages"><div class="msg wed"><div class="avatar">W</div><div class="msg-content">Hello, I’m Wednesday — your assistant. What can I take off your plate today?</div></div></div><form class="composer" id="chat"><input id="prompt" autocomplete="off" placeholder="Ask Wednesday anything… (Shift+Enter for newline)"><button class="send" id="send" aria-label="Send message">↑</button></form></div>
</div>

<div id="view-tools" class="view hidden">
<div class="card tools"><div class="toolhead"><div><div class="label">Tool registry</div><strong id="toolTitle">Loading…</strong></div></div><input id="search" class="search" placeholder="Filter tools"><div id="toolList"></div></div>
</div>

<div id="view-audit" class="view hidden">
<div class="viewhead"><h2>Audit log</h2><button class="linkbtn" onclick="loadAudit(true)">Refresh now</button></div>
<div class="card"><div class="audit-controls"><label class="audit-toggle"><span class="label">Live poll</span><input type="checkbox" id="auditPoll" checked onchange="toggleAuditPoll()"><span>every 5s</span></label><span class="spacer"></span><span class="label" id="auditMeta">—</span></div><div id="auditList"><div class="empty-state">Loading the hash-chained event journal…</div></div></div>
</div>

<div id="view-memory" class="view hidden">
<div class="viewhead"><h2>Memory vault</h2><button class="linkbtn" onclick="loadVault(true)">Refresh</button></div>
<section class="memory-grid">
<div class="card"><div class="label">Memories</div><div class="metric" id="memTotal">—</div></div>
<div class="card"><div class="label">Words</div><div class="metric" id="memWords">—</div></div>
<div class="card"><div class="label">Newest</div><div class="metric" id="memNewest" style="font-size:15px">—</div></div>
<div class="card"><div class="label">Oldest</div><div class="metric" id="memOldest" style="font-size:15px">—</div></div>
</section>
<section class="memory-sub">
<div class="card"><div class="label" style="margin-bottom:12px">By type</div><div id="memTypes"></div><div class="label" style="margin:14px 0 12px">By folder</div><div id="memFolders"></div></div>
<div class="card"><div class="label" style="margin-bottom:12px">Tags</div><div class="tagcloud" id="memTags"><div class="empty-state">No tags yet.</div></div></div>
</section>
<div class="card"><div class="label" style="margin-bottom:6px">Backup &amp; restore</div><div class="mem-actions"><button class="btn allow" id="memExport" onclick="exportVault()">Export vault</button><input class="import-path" id="memImportPath" placeholder="/absolute/path/to/wednesday-export.json"><button class="btn ghost" id="memImport" onclick="importVault(false)">Import</button><button class="btn ghost" id="memImportMerge" onclick="importVault(true)">Import (merge)</button></div><div class="memnote" id="memNote"></div></div>
</div>

<div id="view-models" class="view hidden">
<div class="viewhead"><h2>Models</h2><button class="linkbtn" onclick="loadModels(true)">Refresh</button></div>
<div class="card models" id="modelList"><div class="empty-state">Loading model catalog…</div></div>
</div>

<div id="view-skills" class="view hidden">
<div class="viewhead"><h2>Skills</h2><button class="linkbtn" onclick="loadSkills(true)">Refresh</button></div>
<div class="card skills"><div id="skillList"><div class="empty-state">Loading skills…</div></div></div>
</div>

</main></div><div id="helpModal" class="approvalmodal hidden"><div class="approvalbox"><h2>Commands &amp; tips</h2><pre style="color:var(--text)">/help               list commands
/remember T :: M    save a durable memory
/recall terms       search the vault
/reindex            rebuild memory index
/stale [days]       list untouched memories
/forget Title      delete a memory
/export             back up the whole memory vault
/import <path>     restore memories from a backup
/stats             show vault size and breakdown
/tags              list tags used across memories
/session            show session info
/history            recent memory commits
/model              active model
/effort [level]     reasoning depth
/clear              clear conversation
Streaming answers and reasoning are shown live.</pre><div class="approvalactions"><button class="btn allow" onclick="toggleHelp()">Close</button></div></div></div>
<script>
const token=document.querySelector('#token');token.value=localStorage.wednesdayToken||'';token.onchange=()=>localStorage.wednesdayToken=token.value;const auth=()=>token.value?{Authorization:'Bearer '+token.value}:{};let tools=[];
const messagesEl=document.querySelector('#messages');
let usage;try{usage=JSON.parse(localStorage.wednesdayUsage||'null')}catch(e){usage=null}
if(!usage||typeof usage!=='object')usage={turns:[],toolCalls:{}};
usage.turns=usage.turns||[];usage.toolCalls=usage.toolCalls||{};
function persistUsage(){try{localStorage.wednesdayUsage=JSON.stringify(usage)}catch(e){}}
function resetUsage(){usage={turns:[],toolCalls:{}};persistUsage();renderTokenChart();renderModelBars();renderToolCallBars();renderTokensTodayCard()}
function toggleSidebar(force){const side=document.querySelector('#sidebar');const shell=document.querySelector('#shell');const collapsed=typeof force==='boolean'?force:!side.classList.contains('collapsed');side.classList.toggle('collapsed',collapsed);shell.classList.toggle('collapsed',collapsed);localStorage.wednesdaySidebar=collapsed?'1':'0'}
if(localStorage.wednesdaySidebar==='1')toggleSidebar(true);
function selectView(btn,name){document.querySelectorAll('.nav button[data-view]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));document.querySelector('#view-'+name).classList.remove('hidden');if(name==='chat')setTimeout(()=>document.querySelector('#prompt').focus(),60);if(name==='audit'){renderAudit();loadAudit(false)}if(name==='memory'){renderVault();loadVault(false)}if(name==='models'){renderModels();loadModels(false)}if(name==='skills'){renderSkills();loadSkills(false)}}
async function api(path,options={}){const response=await fetch(path,{...options,headers:{...auth(),...(options.headers||{})}});if(response.status===204)return{};const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||response.statusText);return data}
function escapeHtml(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function scroll(){requestAnimationFrame(()=>{const gap=messagesEl.scrollHeight-messagesEl.scrollTop-messagesEl.clientHeight;if(gap<80)messagesEl.scrollTo({top:messagesEl.scrollHeight,behavior:'auto'})})}
function message(text,role,opts={}){const el=document.createElement('div');el.className='msg '+role;let target=el;if(role==='wed'){const avatar=document.createElement('div');avatar.className='avatar';avatar.textContent='W';const content=document.createElement('div');content.className='msg-content';el.append(avatar,content);target=content}target.append(document.createTextNode(text));if(opts.memories&&opts.memories.length){const chips=document.createElement('div');chips.className='chips';opts.memories.forEach(m=>{const c=document.createElement('span');c.className='chip';c.textContent='↳ '+m;chips.append(c)});target.append(chips)}messagesEl.append(el);scroll();return target}
function setStatus(v){const map={connecting:['var(--muted)','connecting'],thinking:['var(--mustard)','thinking'],ready:['var(--jungle-light)','ready'],error:['var(--rust)','error']};const[color,label]=map[v]||map.connecting;const el=document.querySelector('#health');el.style.color=color;el.textContent=label}
function renderTools(query=''){const list=document.querySelector('#toolList');list.innerHTML='';tools.filter(t=>(t.name+' '+(t.group||t.category)).includes(query.toLowerCase())).forEach(t=>{const row=document.createElement('div');row.className='tool';row.innerHTML='<div><strong>'+t.name+'</strong><br><small>'+t.description+'</small></div><span class="pill">'+(t.group||t.category)+'</span>';list.append(row)})}
function renderCategoryChart(){const el=document.querySelector('#categoryBars');if(!el)return;const counts={};tools.forEach(t=>{const c=t.group||t.category||'other';counts[c]=(counts[c]||0)+1});const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]);document.querySelector('#catTotal').textContent=tools.length+' total';if(entries.length===0){el.innerHTML='<div class="empty-state">No tools registered yet.</div>';return}const max=Math.max(1,...entries.map(e=>e[1]));el.innerHTML='';const palette=['var(--jungle-light)','var(--mustard)','var(--cactus)','var(--jungle)','var(--mustard-dim)'];entries.forEach((entry,i)=>{const [name,count]=entry;const row=document.createElement('div');row.className='catrow';const pct=Math.round((count/max)*100);row.innerHTML='<span class="cname">'+name+'</span><div class="track"><div class="fill" style="width:'+pct+'%;background:'+palette[i%palette.length]+'"></div></div><span class="cnum">'+count+'</span>';el.append(row)})}
function renderToolCallBars(){const el=document.querySelector('#toolCallBars');const entries=Object.entries(usage.toolCalls).sort((a,b)=>b[1]-a[1]);const total=entries.reduce((a,e)=>a+e[1],0);document.querySelector('#toolCallTotal').textContent=total;if(entries.length===0){el.innerHTML='<div class="empty-state">No tool calls yet this session — they will appear here as Wednesday uses tools in chat.</div>';return}const max=Math.max(1,...entries.map(e=>e[1]));el.innerHTML='';const palette=['var(--mustard)','var(--jungle-light)','var(--cactus)','var(--jungle)','var(--mustard-dim)'];entries.slice(0,10).forEach((entry,i)=>{const [name,count]=entry;const row=document.createElement('div');row.className='catrow';const pct=Math.round((count/max)*100);row.innerHTML='<span class="cname">'+name+'</span><div class="track"><div class="fill" style="width:'+pct+'%;background:'+palette[i%palette.length]+'"></div></div><span class="cnum">'+count+'</span>';el.append(row)})}
function pushToolCall(name){if(!name)return;usage.toolCalls[name]=(usage.toolCalls[name]||0)+1;persistUsage();renderToolCallBars()}
function pushTurnUsage(data){let tokens=null;if(typeof data.tokens==='number'&&data.tokens>0)tokens=data.tokens;else if(data&&data.usage&&(typeof data.usage.output_tokens==='number'||typeof data.usage.input_tokens==='number'))tokens=(data.usage.input_tokens||0)+(data.usage.output_tokens||0);let model=null;if(typeof data.model==='string'&&data.model)model=data.model;else if(data.session&&typeof data.session.model==='string'&&data.session.model)model=data.session.model;if(tokens==null&&!model)return;usage.turns.push({ts:Date.now(),tokens,model});if(usage.turns.length>60)usage.turns=usage.turns.slice(-60);persistUsage()
function renderTokensTodayCard(){const startOfDay=new Date();startOfDay.setHours(0,0,0,0);const todayTurns=usage.turns.filter(t=>t.tokens!=null&&t.ts>=startOfDay.getTime());const el=document.querySelector('#tokensToday');if(todayTurns.length===0){el.textContent='—';return}el.textContent=todayTurns.reduce((a,t)=>a+t.tokens,0).toLocaleString()}
function renderStatus(s){if(!s)return;const set=(id,v)=>{const el=document.querySelector(id);if(el)el.textContent=v};set('#statModel',s.modelId||'—');const ctx=typeof s.contextPct==='number'?s.contextPct:0;set('#statContext',ctx.toFixed(1)+'%');const cf=document.querySelector('#statContextFill');if(cf)cf.style.width=Math.max(0,Math.min(100,ctx))+'%';set('#statCache',typeof s.cacheHitPct==='number'?s.cacheHitPct.toFixed(1)+'%':'—');currentThinking=typeof s.thinkingLevel==='string'?s.thinkingLevel:''}
async function loadStats(){try{const s=await api('/v1/stats');renderStatus(s)}catch(e){}}
function renderTokenChart(){const el=document.querySelector('#tokenChart');const pts=usage.turns.filter(t=>t.tokens!=null);const foot=document.querySelector('#tokenFoot');if(pts.length===0){el.innerHTML='<div class="empty-state">No token data yet — this fills in once a chat response reports token usage.</div>';document.querySelector('#tokenWeekTotal').textContent='—';foot.textContent='Populates from live response usage.';return}const values=pts.map(p=>p.tokens);const total=values.reduce((a,b)=>a+b,0);document.querySelector('#tokenWeekTotal').textContent=total.toLocaleString()+' tokens';foot.textContent=pts.length+' turn'+(pts.length===1?'':'s')+' recorded this session';const w=640,h=140,pad=18;const max=Math.max(...values),min=Math.min(...values);const stepX=pts.length>1?(w-pad*2)/(pts.length-1):0;const pts2=values.map((v,i)=>{const x=pad+stepX*i;const y=h-pad-((v-min)/((max-min)||1))*(h-pad*2);return [x,y]});const line=pts2.map((p,i)=>(i===0?'M':'L')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');const area=line+' L'+pts2[pts2.length-1][0].toFixed(1)+' '+(h-pad)+' L'+pts2[0][0].toFixed(1)+' '+(h-pad)+' Z';const dots=pts2.map(p=>'<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="3" fill="#5a9c78" stroke="#1a1712" stroke-width="1.5"/>').join('');const labels=pts2.map((p,i)=>'<text class="axis-label" x="'+p[0].toFixed(1)+'" y="'+(h-2)+'" text-anchor="middle">'+(i+1)+'</text>').join('');const svg='<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none"><defs><linearGradient id="tokenFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5a9c78" stop-opacity="0.35"/><stop offset="100%" stop-color="#5a9c78" stop-opacity="0"/></linearGradient></defs><path d="'+area+'" fill="url(#tokenFade)" stroke="none"/><path d="'+line+'" fill="none" stroke="#5a9c78" stroke-width="2.5"/>'+dots+labels+'</svg>';el.innerHTML=svg}
function renderModelBars(){const el=document.querySelector('#modelBars');const foot=document.querySelector('#modelFoot');const counts={};usage.turns.forEach(t=>{if(t.model)counts[t.model]=(counts[t.model]||0)+1});const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]);if(entries.length===0){el.innerHTML='<div class="empty-state">No model data yet — this fills in once a chat response reports which model answered.</div>';foot.textContent='Populates from live response usage.';return}foot.textContent='Tallied from responses this session';const max=Math.max(...entries.map(e=>e[1]));el.innerHTML='';const palette=['var(--jungle-light)','var(--mustard)','var(--cactus)','var(--jungle)'];entries.forEach((e,i)=>{const [name,count]=e;const pct=Math.round((count/max)*100);const row=document.createElement('div');row.className='modelbar';row.innerHTML='<div class="modelrow"><span class="mname">'+name+'</span><span class="mval">'+count+' turn'+(count===1?'':'s')+'</span></div><div class="track"><div class="fill" style="width:'+pct+'%;background:'+palette[i%palette.length]+'"></div></div>';el.append(row)})}
let streaming=false;async function send(){const input=document.querySelector('#prompt');const prompt=input.value.trim();if(!prompt||streaming)return;input.value='';message(prompt,'you');streaming=true;setStatus('thinking');const sendBtn=document.querySelector('#send');sendBtn.disabled=true;input.disabled=true;const wed=message('','wed');const think=document.createElement('details');think.className='thinking';const sum=document.createElement('summary');sum.textContent='thinking (click to view)';const body=document.createElement('div');think.append(sum,body);wed.append(think);const typing=document.createElement('div');typing.className='typing';typing.innerHTML='<span></span><span></span><span></span>';wed.append(typing);const answerEl=document.createElement('div');answerEl.style.whiteSpace='pre-wrap';wed.append(answerEl);let answer='',thinking='';
try{const res=await fetch('/v1/chat/stream',{method:'POST',headers:{'Content-Type':'application/json',...auth()},body:JSON.stringify({prompt})});const reader=res.body.getReader();const dec=new TextDecoder();let buf='';while(true){const{value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});let idx;while((idx=buf.indexOf('\\n\\n'))>=0){const chunk=buf.slice(0,idx);buf=buf.slice(idx+2);const ev=chunk.match(/^event: (.+)$/m);const dt=chunk.match(/^data: (.+)$/m);if(!ev||!dt)continue;const type=ev[1];const data=JSON.parse(dt[1]);if(type==='status')setStatus(data.value);else if(type==='delta'){if(typing.parentNode)typing.remove();answer+=data.text;answerEl.textContent=answer;scroll();}else if(type==='thinking'){thinking+=data.text;body.textContent=thinking;scroll();}else if(type==='notice'){message(data.text,'sys');}else if(type==='tool'){if(data.phase==='start'){const t=document.createElement('span');t.className='tooltag';t.textContent='▸ '+data.name;wed.append(t);scroll();}else{const last=wed.querySelector('.tooltag:last-of-type');if(last)last.textContent=(data.isError?'✗ ':'✓ ')+data.name;pushToolCall(data.name);}}else if(type==='done'){document.querySelector('#messageCount').textContent=data.session.messages;setStatus('ready');pushTurnUsage(data);renderTokenChart();renderModelBars();renderTokensTodayCard();loadStats()}else if(type==='error'){message('Error: '+data.message,'sys');setStatus('error');}}}}catch(err){message('Error: '+err.message,'sys');setStatus('error');}finally{if(typing.parentNode)typing.remove();streaming=false;sendBtn.disabled=false;input.disabled=false;input.focus();scroll();}}
document.querySelector('#chat').onsubmit=e=>{e.preventDefault();send()};
document.querySelector('#prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
async function clearSession(){try{await api('/v1/session',{method:'DELETE'});document.querySelector('#messageCount').textContent='0';message('Session cleared. Durable memories remain.','sys')}catch(e){message('Error: '+e.message,'sys')}}
function toggleHelp(){document.querySelector('#helpModal').classList.toggle('hidden')}
let auditEvents=[];let auditTimer=null;
const AUDIT_GLYPH={user:'U',wednesday:'W',system:'S',tool:'T'};
const AUDIT_ACTOR={user:'user',wednesday:'wednesday',system:'system',tool:'tool'};
/** Summarise an event payload into a single-line, human-readable detail. */
function auditDetail(ev){const p=ev.payload||{};const keys=Object.keys(p);if(keys.length===0)return '';const short=v=>typeof v==='string'?v:JSON.stringify(v);const pick=(...names)=>names.map(n=>p[n]).find(v=>v!==undefined&&v!==null);if(ev.type==='prompt.accepted')return typeof p.prompt==='string'?p.prompt:'';if(ev.type==='tool.start')return 'started'+(p.name?': '+p.name:'');if(ev.type==='tool.end')return 'finished'+(p.name?': '+p.name:'')+(p.isError?' (error)':'');if(ev.type==='run.completed'||ev.type==='run.failed')return short(p.result??p.error??'');if(ev.type==='memory.committed')return 'committed memory'+(p.title?': '+p.title:'');if(ev.type==='memory.reindexed')return 'rebuilt memory index'+(typeof p.count==='number'?' ('+p.count+' entries)':'');if(ev.type==='vault.exported')return 'exported '+(typeof p.count==='number'?p.count:'')+' memories'+(p.path?(' → '+p.path):'');if(ev.type==='vault.imported')return 'imported '+(typeof p.imported==='number'?p.imported:'')+' memories'+(p.path?(' ← '+p.path):'');if(ev.type==='session.summarized')return 'summarized session'+(typeof p.removed==='number'?(' ('+p.removed+' turns trimmed)'):'');if(ev.type==='session.cleared')return 'cleared conversation'+(typeof p.removed==='number'?(' ('+p.removed+' messages)'):'');if(ev.type==='model.changed')return 'active model → '+(p.label||(p.provider+'/'+p.id));if(ev.type==='effort.changed')return 'reasoning effort → '+(p.level||'?')+(p.model?(' ('+p.model+')'):'');if(ev.type==='knowledge')return typeof p.text==='string'?p.text:'';const picked=pick('text','message','name','title','path','status');return picked!==undefined?short(picked):keys.map(k=>k+': '+short(p[k])).join('  ·  ')}
function fmtTime(iso){try{const d=new Date(iso);if(isNaN(d))return iso;return d.toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch(e){return iso}}
function renderAudit(){const list=document.querySelector('#auditList');if(!list)return;if(auditEvents.length===0){list.innerHTML='<div class="empty-state">No journal events yet — audit entries appear here as Wednesday works.</div>';document.querySelector('#auditMeta').textContent='0 events';return}list.innerHTML='';auditEvents.forEach(ev=>{const row=document.createElement('div');row.className='audit';const actor=ev.actor||'system';const glyph=AUDIT_GLYPH[actor]||'•';const detail=auditDetail(ev);row.innerHTML='<div class="glyph '+actor+'">'+escapeHtml(String(glyph))+'</div><div class="body"><div class="row1"><span class="etype">'+escapeHtml(ev.type||'event')+'</span><span class="actor">'+escapeHtml(actor)+'</span></div>'+(detail?'<div class="detail">'+escapeHtml(detail)+'</div>':'')+'<div class="hash" title="hash-chained event id">'+escapeHtml(ev.hash||'').slice(0,16)+'</div></div><div class="time">'+fmtTime(ev.timestamp)+'</div>';list.append(row)});document.querySelector('#auditMeta').textContent=auditEvents.length+' event'+(auditEvents.length===1?'':'s')}
async function loadAudit(showErrors=true){try{const data=await api('/v1/journal?limit=100');auditEvents=Array.isArray(data.events)?data.events:[];renderAudit()}catch(e){if(showErrors)document.querySelector('#auditMeta').textContent='load failed';else console.warn('audit poll failed',e)}}
function toggleAuditPoll(){if(document.querySelector('#auditPoll').checked){loadAudit(false);startAuditPoll()}else stopAuditPoll()}
function startAuditPoll(){stopAuditPoll();auditTimer=setInterval(()=>loadAudit(false),5000)}
function stopAuditPoll(){if(auditTimer){clearInterval(auditTimer);auditTimer=null}}
async function load(){try{const health=await api('/health');setStatus(health.status==='ok'?'ready':'connecting');const[info,session]=await Promise.all([api('/v1/tools'),api('/v1/session')]);tools=info.tools;document.querySelector('#toolCount').textContent=info.total;document.querySelector('#groupCount').textContent=new Set(tools.map(t=>t.category)).size;document.querySelector('#toolTitle').textContent=info.total+' capabilities';renderTools();renderCategoryChart();document.querySelector('#messageCount').textContent=session.messages;await loadAudit(false);startAuditPoll();loadStats()}catch(e){setStatus('error');document.querySelector('#health').textContent=e.message}}
// Stop polling when the dashboard is hidden/unloaded to avoid background
// fetches after the tab closes.
window.addEventListener('pagehide',stopAuditPoll);document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAuditPoll();else if(document.querySelector('#auditPoll')?.checked)startAuditPoll()});
let vaultData=null;
function memBarRows(obj){const entries=Object.entries(obj||{}).sort((a,b)=>b[1]-a[1]);if(entries.length===0)return '<div class="empty-state">Nothing recorded yet.</div>';const max=Math.max(1,...entries.map(e=>e[1]));const palette=['var(--jungle-light)','var(--mustard)','var(--cactus)','var(--jungle)','var(--mustard-dim)'];return entries.map((entry,i)=>{const[name,count]=entry;const pct=Math.round((count/max)*100);return '<div class="membar"><div class="catrow"><span class="cname">'+escapeHtml(name)+'</span><div class="track"><div class="fill" style="width:'+pct+'%;background:'+palette[i%palette.length]+'"></div></div><span class="cnum">'+count+'</span></div></div>'}).join('')}
function renderVault(){const m=document.querySelector('#view-memory');if(!m||!vaultData)return;const s=vaultData.stats||{};const set=(id,v)=>{const el=document.querySelector(id);if(el)el.textContent=v};set('#memTotal',s.total??'—');set('#memWords',typeof s.totalWords==='number'?s.totalWords.toLocaleString():'—');set('#memNewest',s.newest?escapeHtml(s.newest.title)+' · '+s.newest.ageDays+'d':'—');set('#memOldest',s.oldest?escapeHtml(s.oldest.title)+' · '+s.oldest.ageDays+'d':'—');document.querySelector('#memTypes').innerHTML=memBarRows(s.byType);document.querySelector('#memFolders').innerHTML=memBarRows(s.byFolder);const tagWrap=document.querySelector('#memTags');const tags=vaultData.tags||[];if(tags.length===0)tagWrap.innerHTML='<div class="empty-state">No tags yet.</div>';else tagWrap.innerHTML=tags.map(t=>'<span class="tag">'+escapeHtml(t.tag)+'<b>'+t.count+'</b></span>').join('')}
async function loadVault(showErrors=true){try{const data=await api('/v1/vault');vaultData=data;renderVault()}catch(e){if(showErrors)document.querySelector('#memNote').textContent='Failed to load vault: '+e.message}}
async function exportVault(){const btn=document.querySelector('#memExport');btn.disabled=true;try{const r=await api('/v1/vault/export',{method:'POST'});document.querySelector('#memNote').textContent='Exported '+(r.count??0)+' memories → '+r.path;await loadVault(false)}catch(e){document.querySelector('#memNote').textContent='Export failed: '+e.message}finally{btn.disabled=false}}
async function importVault(merge){const path=document.querySelector('#memImportPath').value.trim();if(!path){document.querySelector('#memNote').textContent='Enter an export file path first.';return}const btn=merge?document.querySelector('#memImportMerge'):document.querySelector('#memImport');btn.disabled=true;try{const r=await api('/v1/vault/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,merge})});document.querySelector('#memNote').textContent='Imported '+r.imported+' · updated '+r.updated+' · skipped '+r.skipped;await loadVault(false)}catch(e){document.querySelector('#memNote').textContent='Import failed: '+e.message}finally{btn.disabled=false}}
let modelCatalog=[];let currentThinking='';
function fmtCost(c){if(!c)return '';const money=v=>'$'+(v/1e6).toFixed(2);return 'in '+money(c.input||0)+' · out '+money(c.output||0)+' /MTok'}
function renderModels(){const list=document.querySelector('#modelList');if(!list)return;if(modelCatalog.length===0){list.innerHTML='<div class="empty-state">No models available — configure a provider key first.</div>';return}const byProvider=new Map();modelCatalog.forEach((m,i)=>{if(!byProvider.has(m.provider))byProvider.set(m.provider,[]);byProvider.get(m.provider).push(i)});let html='';for(const[provider,idxs]of byProvider){const api=modelCatalog[idxs[0]].api?(' · '+modelCatalog[idxs[0]].api):'';html+='<div class="provhead"><span class="provname">'+escapeHtml(provider)+'</span><span class="provapi">'+escapeHtml(api)+'</span></div><div class="modellist">';idxs.forEach(i=>{const m=modelCatalog[i];const tags=[m.reasoning?'reasoning':'',m.vision?'vision':''].filter(Boolean).concat(m.thinkingLevels||[]).map(t=>'<span class="mtag">'+escapeHtml(t)+'</span>').join('');const meta=[m.contextWindow?('ctx '+(m.contextWindow>=1000?(m.contextWindow/1000)+'k':m.contextWindow)):'',m.cost?fmtCost(m.cost):''].filter(Boolean).join('<span>·</span>');const effort=(m.active&&m.thinkingLevels&&m.thinkingLevels.length)?('<div class="effortrow"><span class="elabel">Effort</span>'+m.thinkingLevels.map(l=>'<button class="effortbtn'+(l===currentThinking?' active':'')+'"'+(l===currentThinking?' disabled':'')+'>'+escapeHtml(l)+'</button>').join('')+'</div>'):'';html+='<div class="modelrow'+(m.active?' active':'')+'"><div><div class="mname">'+escapeHtml(m.name||m.id)+(m.active?'<span class="badge">active</span>':'')+'</div>'+(meta?'<div class="mmeta">'+meta+'</div>':'')+(tags?'<div class="mtags">'+tags+'</div>':'')+effort+'</div>'+(m.active?'<button class="usemodel" disabled>Active</button>':'<button class="usemodel" data-idx="'+i+'">Use</button>')+'</div>'});html+='</div>'}list.innerHTML=html}
async function loadModels(showErrors=true){try{const[data,st]=await Promise.all([api('/v1/models'),api('/v1/stats')]);modelCatalog=Array.isArray(data)?data:[];currentThinking=st&&typeof st.thinkingLevel==='string'?st.thinkingLevel:'';renderModels()}catch(e){if(showErrors)document.querySelector('#modelList').innerHTML='<div class="empty-state">Failed to load models: '+escapeHtml(e.message)+'</div>'}}
// Delegate Use clicks to avoid embedding provider/id in inline handlers.
document.querySelector('#modelList').addEventListener('click',async e=>{const eff=e.target.closest('.effortbtn');if(eff&&!eff.disabled){await setEffort(eff.textContent.trim());return}const btn=e.target.closest('.usemodel');if(!btn||btn.disabled)return;const idx=Number(btn.dataset.idx);const m=modelCatalog[idx];if(!m)return;const btns=[...document.querySelectorAll('#modelList .usemodel')];btns.forEach(b=>b.disabled=true);try{await api('/v1/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:m.provider,id:m.id})});await loadModels(false);await loadAudit(false);loadStats()}catch(err){btns.forEach(b=>b.disabled=false);const note=document.createElement('div');note.className='memnote';note.textContent='Switch failed: '+err.message;document.querySelector('#modelList').prepend(note)}});
async function setEffort(level){try{await api('/v1/models/effort',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({level})});await loadModels(false);await loadAudit(false);loadStats()}catch(err){const note=document.createElement('div');note.className='memnote';note.textContent='Effort change failed: '+err.message;document.querySelector('#modelList').prepend(note)}}
let skillCatalog=[];
function renderSkills(){const list=document.querySelector('#skillList');if(!list)return;if(skillCatalog.length===0){list.innerHTML='<div class="empty-state">No skills installed yet. Drop a folder containing a SKILL.md into your skills directory to add one.</div>';return}list.innerHTML='';skillCatalog.forEach(s=>{const row=document.createElement('div');row.className='skillrow';row.innerHTML='<div><strong>'+escapeHtml(s.name)+'</strong>'+(s.version?'<span class="v">v'+escapeHtml(s.version)+'</span>':'')+'<small>'+escapeHtml(s.description)+'</small></div><span class="pill">'+(s.license||'skill')+'</span>';const body=document.createElement('div');body.className='skillbody hidden';body.textContent=s.content||'';row.onclick=()=>body.classList.toggle('hidden');list.append(row);list.append(body)})}
async function loadSkills(showErrors=true){try{const data=await api('/v1/skills');skillCatalog=Array.isArray(data)?data:[];renderSkills()}catch(e){if(showErrors)document.querySelector('#skillList').innerHTML='<div class="empty-state">Failed to load skills: '+escapeHtml(e.message)+'</div>'}}
document.querySelector('#search').oninput=e=>renderTools(e.target.value);renderTokenChart();renderModelBars();renderToolCallBars();renderTokensTodayCard();load();
</script></body></html>`;