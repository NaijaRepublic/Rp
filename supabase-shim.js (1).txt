// GitHub Pages + Supabase shim: intercepts the old PHP /api/* fetch() calls
// and answers them from Supabase. No server, no PHP.
(function(){
  var cfg = window.NR_CONFIG || {};
  if(!cfg.SUPABASE_URL || cfg.SUPABASE_URL.indexOf("YOUR_PROJECT")!==-1){
    console.warn("NR: fill in config.js with your Supabase URL + anon key");
  }
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  window.NR_SB = sb;
  var origFetch = window.fetch.bind(window);
  function devId(){ try{ var d=localStorage.getItem("nr_dev"); if(!d){ d="dev_"+Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem("nr_dev",d);} return d;}catch(e){ return "dev_"+Math.random().toString(36).slice(2);} }
  function nowSec(){ return Date.now()/1000; }
  function jsonResp(obj, ok){ return Promise.resolve(new Response(JSON.stringify(obj),{status: ok===false?400:200, headers:{"Content-Type":"application/json"}})); }
  async function me(){
    var r = await sb.auth.getUser(); var u = r.data && r.data.user;
    if(!u) return null;
    var p = await sb.from("profiles").select("*").eq("id", u.id).maybeSingle();
    var prof = p.data || {};
    return { name: prof.name || (u.user_metadata && u.user_metadata.name) || u.email, email: u.email, role: prof.is_admin ? "admin" : "member", seat: prof.is_admin ? 1 : null, id: u.id };
  }
  async function sendEmail(subject, fields){
    try{ await sb.functions.invoke("send-email", { body: { subject: subject, fields: fields } }); }catch(e){ console.warn("email function failed", e); }
  }
  window.fetch = function(input, init){
    var url = typeof input==="string" ? input : (input && input.url) || "";
    // music: no file on Pages -> 404 so the player stays hidden
    if(url.indexOf("music.mp3")!==-1) return Promise.resolve(new Response("",{status:404}));
    if(url.indexOf("/api/")===-1) return origFetch(input, init);
    var path = url.split("?")[0]; path = path.replace(/^https?:\/\/[^\/]+/,"");
    var method = (init && init.method) || "GET";
    var body = {}; try{ body = init && init.body ? JSON.parse(init.body) : {}; }catch(e){}
    var run = (async function(){
      if(path==="/api/site"){
        var news = await sb.from("news").select("*").order("ts",{ascending:false}).limit(30);
        var kv = await sb.from("kv").select("*").in("k",["launch","community"]);
        var map={}; (kv.data||[]).forEach(function(r){map[r.k]=r.v});
        var vis = await sb.from("visitors").select("vid,last",{count:"exact"});
        var online = (vis.data||[]).filter(function(v){return v.last > nowSec()-150}).length;
        return jsonResp({ visitors: (vis.data||[]).length, online: online, community: Number(map.community||0), launch: map.launch||"", news: (news.data||[]).map(function(n){return {id:n.id,title:n.title,body:n.body,kind:n.kind,whn:n.whn,img:n.img,ts:n.ts}}) });
      }
      if(path==="/api/visit"){
        var vid = devId();
        await sb.from("visitors").upsert({vid:vid, ts: nowSec(), last: nowSec()}, {onConflict:"vid"});
        return jsonResp({ok:true});
      }
      if(path==="/api/me"){ var u = await me(); return jsonResp({user:u}); }
      if(path==="/api/logout"){ await sb.auth.signOut(); return jsonResp({ok:true}); }
      if(path==="/api/auth"){
        var email = String(body.email||"").trim().toLowerCase(), pw = String(body.password||"");
        if(!email || !pw) return jsonResp({error:"Enter email and password."}, false);
        if(body.mode==="join"){
          var s = await sb.auth.signUp({email:email, password:pw, options:{data:{name: body.name||""}}});
          if(s.error) return jsonResp({error: s.error.message}, false);
          var uid = s.data.user && s.data.user.id;
          if(uid) await sb.from("profiles").upsert({id:uid, email:email, name: body.name||"", is_admin: email===String(cfg.ADMIN_EMAIL||"").toLowerCase()}, {onConflict:"id"});
          // If email confirmation is ON in Supabase, user must confirm first - then sign in again.
          if(!s.data.session) return jsonResp({error:"Check your email to confirm your account, then sign in."}, false);
        } else {
          var si = await sb.auth.signInWithPassword({email:email, password:pw});
          if(si.error) return jsonResp({error: si.error.message}, false);
        }
        return jsonResp({user: await me()});
      }
      if(path==="/api/order" || path==="/api/topup"){
        var coins = Number(body.coins||body.amount||0);
        var oid = "NR-"+new Date().toISOString().slice(5,10).replace("-","")+"-"+Math.random().toString(36).slice(2,8).toUpperCase();
        await sb.from("orders").insert({id:oid, ts: nowSec(), email: body.email||"", player: body.player||body.player_id||"", server: body.server||"", coins: coins, total: Number(body.total||0), method: body.method||"", region: body.region||""});
        await sendEmail("NEW TOP-UP ORDER "+oid, body);
        return jsonResp({ok:true, id: oid});
      }
      if(path==="/api/recovery" || path==="/api/partnership" || path==="/api/contact"){
        var subj = path==="/api/recovery" ? "ACCOUNT RECOVERY REQUEST" : path==="/api/partnership" ? "BUSINESS PARTNERSHIP ENQUIRY" : "GENERAL SUPPORT MESSAGE";
        await sb.from("forms").insert({kind: subj, ts: nowSec(), payload: body});
        await sendEmail(subj, body);
        return jsonResp({ok:true});
      }
      // ---- Admin ----
      var u2 = await me();
      function needAdmin(){ if(!u2 || u2.role!=="admin") throw new Error("Administrator access required."); }
      if(path==="/api/admin/members"){ needAdmin(); var m = await sb.from("profiles").select("*").order("created_at",{ascending:false}).limit(500); return jsonResp({members:(m.data||[]).map(function(x){return {name:x.name, email:x.email, joined: x.created_at}})}); }
      if(path==="/api/admin/seats"){ needAdmin(); return jsonResp({seats:[{seat:1, last: nowSec()}], me:1, max:10}); }
      if(path==="/api/admin/news" && method==="POST"){ needAdmin(); var ins = await sb.from("news").insert({title:body.title, body:body.body, kind:body.kind, whn:body.when||"", img:body.img||"", ts: nowSec()}); if(ins.error) throw ins.error; return jsonResp({ok:true}); }
      if(path.indexOf("/api/admin/news/")===0 && method==="DELETE"){ needAdmin(); var id = path.split("/").pop(); await sb.from("news").delete().eq("id", id); return jsonResp({ok:true}); }
      if(path==="/api/admin/launch"){ needAdmin(); await sb.from("kv").upsert({k:"launch", v: body.launch||""}, {onConflict:"k"}); return jsonResp({ok:true}); }
      if(path==="/api/admin/community"){ needAdmin(); await sb.from("kv").upsert({k:"community", v: String(body.community||0)}, {onConflict:"k"}); return jsonResp({ok:true}); }
      if(path==="/api/admin/seats/revoke"){ needAdmin(); return jsonResp({ok:true}); }
      return jsonResp({error:"Not found."}, false);
    })();
    return run.catch(function(e){ return jsonResp({error: e.message || "Something went wrong. Please try again."}, false); });
  };
  // Download: only after launch, else toast (same behaviour as PHP)
  document.addEventListener("click", function(e){
    var a = e.target.closest && e.target.closest('a[href="/download"], a[href="#download"]');
    if(!a) return;
    e.preventDefault();
    sb.from("kv").select("v").eq("k","launch").maybeSingle().then(function(r){
      var live = r.data && r.data.v && new Date(r.data.v).getTime() <= Date.now();
      if(live) window.open(cfg.APK_URL, "_blank");
      else { var t=document.getElementById("toast"); if(t){ t.textContent="Not available yet. The download opens when the launch countdown ends."; t.style.display="block"; setTimeout(function(){t.style.display="none"},3500);} }
    });
  });
})();
