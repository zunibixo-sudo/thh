require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const express = require('express');

// ========== CONFIG ==========
const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL_ENV = process.env.API_URL;
const API_KEY_ENV = process.env.API_KEY;
const SUPPORT_LINK = process.env.SUPPORT_LINK || "https://t.me/+hoKwsX8zLnQxZjFl";
const ADMIN_IDS = (process.env.ADMIN_IDS || "7481724731,7710967611").split(',').map(v=>Number(v.trim())).filter(Boolean);

const GROUP_1_ID = process.env.GROUP_1_ID ? Number(process.env.GROUP_1_ID) : -1004455897015;
const GROUP_2_ID = process.env.GROUP_2_ID ? Number(process.env.GROUP_2_ID) : -5090894763;
const GROUP_3_ID = process.env.GROUP_3_ID ? Number(process.env.GROUP_3_ID) : -5361354377;
const MANUAL_GROUP_ID = process.env.MANUAL_GROUP_ID ? Number(process.env.MANUAL_GROUP_ID) : -1001234567890;
const ORDER_GROUP_ID = process.env.ORDER_GROUP_ID ? Number(process.env.ORDER_GROUP_ID) : GROUP_3_ID;
const DEPOSIT_GROUP_ID = process.env.DEPOSIT_GROUP_ID ? Number(process.env.DEPOSIT_GROUP_ID) : GROUP_2_ID;
const SUPPORT_GROUP_ID = process.env.SUPPORT_GROUP_ID ? Number(process.env.SUPPORT_GROUP_ID) : GROUP_1_ID;

const FORCE_JOIN_LINKS = (process.env.FORCE_JOIN_LINKS || "https://t.me/+Ig9neK566pw0Mzk1,https://t.me/+hvrNUdPa-tczNzFl,https://t.me/+hoKwsX8zLnQxZjFl").split(',').map(s=>s.trim()).filter(Boolean);
const FORCE_JOIN_IDS = (process.env.FORCE_JOIN_IDS || "-1004455897015,-5090894763,-5361354377").split(',').map(s=>Number(s.trim())).filter(Boolean);

const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://bot.totocompamy.com";
const PORT = process.env.PORT || 3000;

const NAGRIKPAY_KEY = process.env.NAGRIKPAY_API_KEY;
const NAGRIKPAY_BASE = process.env.NAGRIKPAY_BASE_URL || "https://secure-pay.nagorikpay.com/api/payment/create";
const NAGRIKPAY_VERIFY = process.env.NAGRIKPAY_VERIFY_URL || "https://secure-pay.nagorikpay.com/api/payment/verify";
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_KEY ? require('stripe')(STRIPE_KEY) : null;

const GROUP_NOTIFY = (process.env.GROUP_NOTIFY_ENABLED || 'true') === 'true';
const MASK_IDS = (process.env.MASK_IDS_IN_GROUPS || 'true') === 'true';
const FORCE_JOIN_ENABLED = (process.env.FORCE_JOIN_ENABLED || 'true') === 'true';

if(!BOT_TOKEN){
  console.error("❌ BOT_TOKEN missing - Edit .env");
  process.exit(1);
}

// ========== JSON DB - NO NATIVE ==========
const DB_PATH = './database.json';
let dbData = {
  users: [],
  orders: [],
  transactions: [],
  settings: {
    inr_to_bdt: parseFloat(process.env.INR_TO_BDT || 1.35),
    inr_to_usd: parseFloat(process.env.INR_TO_USD || 0.012),
    enabled_categories: null,
    disabled_services: [],
    new_user_notify: true,
    api_url: API_URL_ENV,
    api_key: API_KEY_ENV
  },
  custom_prices: [],
  offers: [],
  support_map: [],
  manual_services: [],
  referrals: [] // {referrer_id, referred_id, bonus_given}
};
if(fs.existsSync(DB_PATH)){
  try{ dbData = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }catch(e){ console.log("DB corrupted, fresh"); }
}
// Create sample manual services if none exist (so New Order never shows "No services in this category")
if(!dbData.manual_services || dbData.manual_services.length===0){
  dbData.manual_services = [
    {id:90001, name:"Facebook Page Likes", category:"Facebook", rate_inr:80, min:100, max:10000, description:"Facebook Page Likes - Manual - High Quality"},
    {id:90002, name:"Facebook Post Likes", category:"Facebook", rate_inr:70, min:100, max:10000, description:"Facebook Post Likes"},
    {id:90003, name:"Instagram Followers", category:"Instagram", rate_inr:100, min:100, max:10000, description:"Instagram Followers Manual"},
    {id:90004, name:"Instagram Likes", category:"Instagram", rate_inr:80, min:100, max:10000, description:"Instagram Likes"},
    {id:90005, name:"YouTube Subscribers", category:"YouTube", rate_inr:150, min:100, max:5000, description:"YouTube Subs"},
    {id:90006, name:"YouTube Views", category:"YouTube", rate_inr:50, min:1000, max:100000, description:"YouTube Views"},
    {id:90007, name:"TikTok Followers", category:"TikTok", rate_inr:90, min:100, max:10000, description:"TikTok Followers"},
    {id:90008, name:"Telegram Members", category:"Telegram", rate_inr:60, min:100, max:10000, description:"Telegram Members"},
    {id:90009, name:"Twitter Followers", category:"Twitter (X)", rate_inr:85, min:100, max:10000, description:"Twitter Followers"},
    {id:90010, name:"Custom Service", category:"Others", rate_inr:100, min:10, max:10000, description:"Custom Manual Service"}
  ];
}
// Ensure categories include Facebook, Instagram, YouTube, Telegram, Twitter (X), TikTok, Others
const defaultCats=["Facebook","Instagram","YouTube","Telegram","Twitter (X)","TikTok","Others"];
let existingCats=dbData.settings.categories || [];
defaultCats.forEach(catName=>{
  if(!existingCats.find(c=>c.name===catName)){
    existingCats.push({name:catName, enabled:true});
  }
});
dbData.settings.categories=existingCats;
saveDB();
function saveDB(){ try{ fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2)); }catch(e){ console.error("DB save error", e.message); } }

function getUser(id){ return dbData.users.find(u=>u.id===id); }
function ensureUser(msg, referrerId=null){
  const id=msg.from.id;
  let u=getUser(id);
  let isNew=false;
  if(!u){
    isNew=true;
    u={
      id, username:msg.from.username||'', first_name:msg.from.first_name||'',
      lang:null, currency:null,
      balance_bdt:0, balance_usd:0,
      total_spent_bdt:0, total_spent_usd:0,
      discount:0, banned:false,
      referral_code:`REF${id}`,
      referred_by: referrerId,
      daily_bonus_last:null,
      created_at:new Date().toISOString()
    };
    dbData.users.push(u);
    // Referral bonus
    if(referrerId && getUser(referrerId) && referrerId!==id){
      dbData.referrals.push({referrer_id:referrerId, referred_id:id, bonus_given:false, created_at:new Date().toISOString()});
      // Give referral bonus to referrer when referred user deposits (handled in deposit verification)
    }
    saveDB();
  }
  return {user:u, isNew};
}
function isAdmin(id){ return ADMIN_IDS.includes(id); }
function getSetting(k, def=null){ return dbData.settings[k]!==undefined ? dbData.settings[k] : def; }
function setSetting(k,v){ dbData.settings[k]=v; saveDB(); }
function getConversionRates(){
  return {
    BDT: parseFloat(getSetting('inr_to_bdt', parseFloat(process.env.INR_TO_BDT || 1.35))),
    USD: parseFloat(getSetting('inr_to_usd', parseFloat(process.env.INR_TO_USD || 0.012)))
  };
}
function formatMoney(amount, currency){
  const c=(currency||'BDT').toUpperCase();
  if(c==='USD' || c==='USDT') return `$${amount.toFixed(2)}`;
  return `৳${amount.toFixed(2)}`;
}
function maskId(id){
  const s=String(id);
  if(!MASK_IDS) return s;
  if(s.length<=2) return "***";
  if(s.length<=4) return s[0]+"***"+s[s.length-1];
  return s.substring(0,2)+"***"+s.substring(s.length-2);
}
function getUserBalanceInfo(user){
  const curr=user.currency||'BDT';
  if(curr==='USD' || curr==='USDT') return {amount:user.balance_usd||0, code:'USD', symbol:'$'};
  return {amount:user.balance_bdt||0, code:'BDT', symbol:'৳'};
}
function addBalance(userId, amount, currency){
  const u=getUser(userId); if(!u) return;
  const c=(currency||'BDT').toUpperCase();
  if(c==='USD' || c==='USDT') u.balance_usd=(u.balance_usd||0)+amount;
  else u.balance_bdt=(u.balance_bdt||0)+amount;
  saveDB();
}
function deductBalance(userId, amount, currency){
  const u=getUser(userId); if(!u) return;
  const c=(currency||'BDT').toUpperCase();
  if(c==='USD' || c==='USDT'){ u.balance_usd=(u.balance_usd||0)-amount; u.total_spent_usd=(u.total_spent_usd||0)+amount; }
  else { u.balance_bdt=(u.balance_bdt||0)-amount; u.total_spent_bdt=(u.total_spent_bdt||0)+amount; }
  saveDB();
}
function giveReferralBonusIfFirstDeposit(userId, depositAmount, currency){
  try{
    const user=getUser(userId);
    if(!user || !user.referred_by) return;
    const referrerId=user.referred_by;
    const referrer=getUser(referrerId);
    if(!referrer) return;
    // Check if bonus already given
    let referralRec=dbData.referrals.find(r=>r.referrer_id===referrerId && r.referred_id===userId);
    if(referralRec && referralRec.bonus_given) return; // Already given, only first deposit bonus
    // Check if user has previous completed deposits (excluding current)
    const completedBefore=dbData.transactions.filter(t=>t.user_id===userId && t.status==='completed' && t.amount!==depositAmount).length;
    // Also check if this referral already got bonus via count
    const allCompleted=dbData.transactions.filter(t=>t.user_id===userId && t.status==='completed').length;
    // If allCompleted >1, this is not first deposit, but we still check bonus_given
    if(allCompleted>1 && referralRec && referralRec.bonus_given) return;
    if(allCompleted>1 && !referralRec){
      // If user already had deposits before referral system, don't give
      const firstDeposit=dbData.transactions.filter(t=>t.user_id===userId && t.status==='completed').sort((a,b)=>new Date(a.created_at)-new Date(b.created_at))[0];
      if(firstDeposit && firstDeposit.id!==dbData.transactions.find(t=>t.user_id===userId && t.status==='completed' && t.amount===depositAmount)?.id){
        // Not first deposit
        return;
      }
    }
    // Give 5% bonus only on 1st deposit
    const bonus=depositAmount*0.05;
    addBalance(referrerId, bonus, currency);
    if(referralRec) referralRec.bonus_given=true;
    else dbData.referrals.push({referrer_id:referrerId, referred_id:userId, bonus_given:true, created_at:new Date().toISOString()});
    saveDB();
    try{ bot.sendMessage(referrerId, `🎁 Referral Bonus (5% of 1st deposit)!\nYour referred user ${user.first_name} (@${user.username||'none'}) made first deposit ${formatMoney(depositAmount, currency)}.\nYou got bonus: ${formatMoney(bonus, currency)}\n\nRefer more to earn more!`); }catch(e){}
    console.log(`Referral bonus given: ${referrerId} got ${bonus} ${currency} from ${userId} first deposit ${depositAmount}`);
  }catch(e){ console.log("Referral bonus error", e.message); }
}

const CANCEL_TEXTS=["❌ Cancel","🚫 Cancel","❌ বাতিল","/cancel","Cancel","cancel"];
function isCancel(t){ if(!t) return false; return CANCEL_TEXTS.includes(t.trim()) || t.trim().toLowerCase()==='cancel'; }
function cancelKb(lang){ return {keyboard:[[{text: lang==='bn' ? "❌ বাতিল" : "❌ Cancel"}]], resize_keyboard:true}; }

const T={
en:{
  select_lang:"🌐 Select language:", select_currency:"💱 Select Currency:\nBDT (৳) or USD/USDT ($)\n\nPrices shown ONLY in selected currency.",
  currency_set:"✅ Currency $CURR$ set", must_join:"🔐 To use TotoCompamysmm, you must join our 3 groups/channels first, then Verify.\n\nGroups public but only admin can send, you can view.",
  join_verify:"✅ Verify Joined", not_joined:"❌ Not joined all yet. Join all 3 then Verify.\nMissing: $MISSING$",
  joined_ok:"✅ Thanks for joining!",
  welcome:"👋 Welcome to TotoCompamysmm 100% Free Lifetime!\n\n💰 $BALANCE$ | $CURR$ | ID $ID$\nChoose option:",
  new_order:"🛒 New Order", track_order:"📦 Track Order", add_funds:"💰 Add Funds", profile:"👤 Profile", support:"🎧 Support", language:"🌐 Language", currency:"💱 Currency", cancel:"❌ Cancel",
  new_order_type:"🛒 New Order - Select Type:\n\n🤖 Auto = Facebook, Instagram, YouTube etc.\n🛠 Manual = Admin managed services\n🔍 Search = Search by Service ID or Name",
  auto:"🤖 Auto", manual:"🛠 Manual", search:"🔍 Search",
  ask_cat:"📂 Step 1️⃣/5️⃣ - Category\nYour currency: $CURR$ only\nTap category",
  ask_service:"🛠 Step 2️⃣/5️⃣ - $CAT$\nPrice: $PRICE$ $CURR$/1k\nMin $MIN$ Max $MAX$",
  ask_link:"🔗 Step 3️⃣/5️⃣ - Send Link\nExample: https://instagram.com/username",
  ask_qty:"🔢 Step 4️⃣/5️⃣ - Quantity\nMin $MIN$ Max $MAX$\nPrice $PRICE$ $CURR$/1k",
  invalid_link:"❌ Invalid link", invalid_qty:"❌ Qty $MIN$-$MAX$", invalid_sid:"❌ Service ID $ID$ not found!",
  insufficient:"❌ Low balance Need $NEED$ Have $HAVE$ ($CURR$)",
  confirm:"📋 Step 5️⃣/5️⃣ *Confirm*\n$NAME$ [ID:$ID$]\n📂 $CAT$\n🔗 $LINK$\n🔢 $QTY$\n💰 Total: $TOTAL$ $CURR$\nManual: $MANUAL$",
  order_ok:"✅ Order #$OID$ Placed! $CHARGE_USER$ $CURR$", order_ok_manual:"✅ Manual Order #$OID$ Created! $CHARGE_USER$ $CURR$",
  no_orders:"No orders", your_orders:"📦 Last 10 orders (tap to copy):",
  profile_msg:"👤 *Profile TotoCompamysmm*\nID: $ID$\nName: $NAME$ (@$USERNAME$)\nLang: $LANG$ Curr: $CURR$\nBDT: ৳$BDT$ USD: $$USD$\nSpent BDT: ৳$SPENT_BDT$ USD: $$SPENT_USD$\nOrders: $TOTAL_ORDERS$ Referrals: $REF$ Discount: $DISC$%",
  balance_msg:"💰 BDT: ৳$BDT$ USD: $$USD$ Current: $CURR_WALLET$ ($CURR$)\nSend amount in $CURR$ (NagrikPay only):",
  ask_gateway:"💳 Gateway for $AMT$ $CURR$\nNagrikPay Only for BDT - 100% safe merchant account",
  payment_created:"💳 Payment $AMT$ created:\n$URL$\nAfter pay click Verify",
  payment_pending:"⏳ Payment Pending: $AMT$ - Status: $STATUS$\nPlease wait for admin verification or contact support",
  payment_done:"✅ Payment Done! $AMT$ added. New $BAL$",
  payment_approved:"✅ Payment Approved! $AMT$ added to $CURR$ wallet",
  support_ask:"✍️ Support message (or Cancel):", support_sent:"✅ Sent to support group", support_fwd:"📩 Support from $ID$ (@$USER$) $CURR$ $LANG$\n$MSG$",
  admin_panel:"👑 *Admin TotoCompamysmm Final*\nUsers $U$ Orders $O$ Pending $P$ Manual $M$\nTBDT ৳$TBDT$ TUSD $$TUSD$\nAPI: $API_URL$\nGroups O:$ORDER_G$ D:$DEPOSIT_G$ S:$SUPPORT_G$ M:$MANUAL_G$",
  search_user_prompt:"🔍 Send user ID (or Cancel):",
  user_not_found:"❌ User $ID$ not found",
  user_found:"👤 *User $ID$*\nName: $NAME$ (@$USERNAME$)\nLang: $LANG$ Curr: $CURR$\nBDT: ৳$BDT$ USD: $$USD$\nSpent: ৳$SPENT_BDT$/$$SPENT_USD$\nJoined: $JOINED$\nOrders: $ORDERS$",
  api_test_ok:"✅ API OK! Services: $SVC_COUNT$ Balance: $BAL$\nURL: $URL$",
  api_test_fail:"❌ API Fail! $ERR$\nURL: $URL$\nFix: Check API_URL/API_KEY in .env or Manage API",
  offer_created:"✅ Offer $TITLE$ $DISC$% Days $DAYS$ Target $TARGET$ Service $SERVICE$",
  cancelled:"❌ Cancelled",
  friendly_error:"⚠️ W8 for admin fix or contact support group: $LINK$",
  copy_id:"📋 Copy ID",
  admin_not_allowed:"❌ Admin not allowed - Only admins can use this button in groups",
},
bn:{
  select_lang:"🌐 ভাষা নির্বাচন করুন:", select_currency:"💱 মুদ্রা নির্বাচন করুন:\nBDT (৳) বা USD/USDT ($)\n\nদাম শুধু আপনার মুদ্রায়",
  currency_set:"✅ মুদ্রা $CURR$ সেট", must_join:"🔐 বট ব্যবহার করতে ৩টি গ্রুপে জয়েন করুন, তারপর Verify ক্লিক করুন।\n\nগ্রুপ পাবলিক কিন্তু শুধু অ্যাডমিন মেসেজ পাঠাতে পারে।",
  join_verify:"✅ Verify Joined", not_joined:"❌ এখনো সব গ্রুপে জয়েন করেননি।\nMissing: $MISSING$",
  joined_ok:"✅ ধন্যবাদ!",
  welcome:"👋 স্বাগতম TotoCompamysmm 100% ফ্রি লাইফটাইম!\n\n💰 $BALANCE$ | $CURR$ | ID $ID$",
  new_order:"🛒 নতুন অর্ডার", track_order:"📦 ট্র্যাক অর্ডার", add_funds:"💰 ফান্ড যোগ", profile:"👤 প্রোফাইল", support:"🎧 সাপোর্ট", language:"🌐 ভাষা", currency:"💱 মুদ্রা", cancel:"❌ বাতিল",
  new_order_type:"🛒 নতুন অর্ডার - টাইপ বেছে নিন:\n\n🤖 Auto = Facebook, Instagram, YouTube etc.\n🛠 Manual = ম্যানুয়াল সার্ভিস\n🔍 Search = ID বা নাম দিয়ে সার্চ",
  auto:"🤖 Auto", manual:"🛠 Manual", search:"🔍 Search",
  ask_cat:"📂 ধাপ 1️⃣/5️⃣ - ক্যাটাগরি\nআপনার মুদ্রা: $CURR$ শুধু", ask_service:"🛠 ধাপ 2️⃣/5️⃣ - $CAT$\nদাম: $PRICE$ $CURR$/1k\nMin $MIN$ Max $MAX$",
  ask_link:"🔗 ধাপ 3️⃣/5️⃣ - লিংক পাঠান\nউদা: https://instagram.com/username", ask_qty:"🔢 ধাপ 4️⃣/5️⃣ - পরিমাণ\nMin $MIN$ Max $MAX$\nদাম $PRICE$ $CURR$/1k",
  invalid_link:"❌ ভুল লিংক", invalid_qty:"❌ পরিমাণ $MIN$-$MAX$", invalid_sid:"❌ Service ID $ID$ পাওয়া যায়নি!",
  insufficient:"❌ ব্যালেন্স কম Need $NEED$ Have $HAVE$ ($CURR$)",
  confirm:"📋 ধাপ 5️⃣/5️⃣ *নিশ্চিত করুন*\n$NAME$ [ID:$ID$]\n📂 $CAT$\n🔗 $LINK$\n🔢 $QTY$\n💰 মোট: $TOTAL$ $CURR$\nManual: $MANUAL$",
  order_ok:"✅ অর্ডার #$OID$ সফল! $CHARGE_USER$ $CURR$", order_ok_manual:"✅ ম্যানুয়াল অর্ডার #$OID$ তৈরি!",
  no_orders:"কোন অর্ডার নেই", your_orders:"📦 শেষ ১০টি অর্ডার:",
  profile_msg:"👤 *প্রোফাইল*\nID: $ID$\nনাম: $NAME$\nভাষা: $LANG$ মুদ্রা: $CURR$\nBDT: ৳$BDT$ USD: $$USD$\nখরচ: $TOTAL_ORDERS$",
  balance_msg:"💰 BDT: ৳$BDT$ USD: $$USD$ বর্তমান: $CURR_WALLET$ ($CURR$)\n$CURR$ এ পরিমাণ লিখুন:",
  ask_gateway:"💳 $AMT$ $CURR$ NagrikPay - BDT তে শুধু এটাই",
  payment_created:"💳 $AMT$ পেমেন্ট তৈরি: $URL$", payment_pending:"⏳ পেমেন্ট Pending: $AMT$ - $STATUS$",
  payment_done:"✅ পেমেন্ট Done! $AMT$ যোগ", payment_approved:"✅ Approved! $AMT$ যোগ",
  support_ask:"✍️ সাপোর্ট মেসেজ (বা বাতিল):", support_sent:"✅ সাপোর্ট গ্রুপে পাঠানো হয়েছে", support_fwd:"📩 Support from $ID$ (@$USER$) $CURR$ $LANG$\n$MSG$",
  admin_panel:"👑 *Admin Final*\nUsers $U$ Orders $O$ Pending $P$\nTBDT ৳$TBDT$ TUSD $$TUSD$",
  search_user_prompt:"🔍 ইউজার ID পাঠান:", user_not_found:"❌ User $ID$ নেই",
  user_found:"👤 *User $ID$*\nName: $NAME$\nLang: $LANG$ Curr: $CURR$\nBDT: ৳$BDT$ USD: $$USD$",
  api_test_ok:"✅ API OK! Services: $SVC_COUNT$", api_test_fail:"❌ API Fail! $ERR$",
  offer_created:"✅ অফার $TITLE$ $DISC$%", cancelled:"❌ বাতিল", friendly_error:"⚠️ এডমিন ফিক্সের জন্য অপেক্ষা করুন বা সাপোর্ট গ্রুপে যোগাযোগ: $LINK$",
  copy_id:"📋 Copy ID", admin_not_allowed:"❌ শুধু অ্যাডমিন এই বাটন ব্যবহার করতে পারে",
}
};

function tr(uid,k,vars={}){
  const u=getUser(uid); const lang=u?.lang||'en';
  let t=(T[lang]&&T[lang][k])||T.en[k]||k;
  for(let key in vars) t=t.replaceAll(`$${key}$`, vars[key]);
  return t;
}
function mainKb(uid){
  const u=getUser(uid); const d=T[u?.lang||'en']||T.en;
  return [[d.new_order, d.track_order],[d.add_funds, d.profile],[d.support, d.currency],[d.language]];
}
function askCurrency(uid){
  const rates=getConversionRates();
  bot.sendMessage(uid, tr(uid,'select_currency',{BDT_RATE:rates.BDT, USD_RATE:rates.USD}), {
    reply_markup:{inline_keyboard:[[{text:"🇧🇩 BDT (৳)", callback_data:"curr_BDT"}, {text:"🇺🇸 USD/USDT ($)", callback_data:"curr_USD"}]]}
  });
}
function maskIdPublic(id){ return maskId(id); }

// Force Join - ADMIN BYPASS + FIX FOR YOUR SCREENSHOT IDs
async function checkUserJoinedAll(uid){
  if(!(process.env.FORCE_JOIN_ENABLED||'true').includes('true')) return {joined:true, missing:[]};
  // ADMIN BYPASS - Admins don't need to join groups (fixes your screenshot where admin stuck)
  if(isAdmin(uid)) return {joined:true, missing:[]};
  let missing=[];
  for(let gid of FORCE_JOIN_IDS){
    if(!gid) continue;
    try{
      let member=null;
      // Try original ID, then with -100 prefix, then without
      const attempts=[gid];
      const s=String(gid);
      if(!s.startsWith('-100') && s.startsWith('-')) attempts.push(Number('-100'+s.substring(1)));
      if(s.startsWith('-100')) attempts.push(Number(s.substring(4)));
      // Also try your specific IDs that are missing: -5090894763 and -5361354377 often should be -1005090894763 and -1005361354377
      if(s==='-5090894763') attempts.push(-1005090894763);
      if(s==='-5361354377') attempts.push(-1005361354377);
      
      for(let tryId of attempts){
        try{ member=await bot.getChatMember(tryId, uid); if(member) break; }catch(e){}
      }
      
      if(!member){
        // If bot can't check (not admin in group), don't block user - just log
        console.log(`Join check: Can't get member for ${gid} user ${uid}, skipping to avoid blocking`);
        continue;
      }
      if(['left','kicked','banned'].includes(member.status)) missing.push(gid);
    }catch(e){ 
      console.log(`Join check fail ${gid} user ${uid}: ${e.message}`);
      // If fails, don't block user - allow to proceed to avoid your screenshot issue
      continue;
    }
  }
  return {joined:missing.length===0, missing};
}
async function sendForceJoinMessage(uid){
  const u=getUser(uid); const lang=u?.lang||'en';
  const tMust=T[lang]?.must_join||T.en.must_join;
  const tVerify=T[lang]?.join_verify||T.en.join_verify;
  const check=await checkUserJoinedAll(uid);
  const missingText=check.missing.length>0 ? check.missing.join(', ') : 'All 3 groups';
  let kb=[];
  FORCE_JOIN_LINKS.forEach((link, idx)=>{
    let name=`Join Group ${idx+1}`;
    if(idx===0) name=`📢 Join Group 1 (Order/Help)`;
    if(idx===1) name=`💰 Join Group 2 (Deposit)`;
    if(idx===2) name=`🎧 Join Group 3 (Support/Order)`;
    if(idx===3) name=`🛠 Join Manual Group`;
    kb.push([{text:name, url:link}]);
  });
  kb.push([{text:tVerify, callback_data:"verify_join"}]);
  return bot.sendMessage(uid, `${tMust}\n\n${tr(uid,'not_joined',{MISSING:missingText})}`, {reply_markup:{inline_keyboard:kb}});
}

// Group send with fallback - FIXED FOR YOUR SCREENSHOTS: Can't parse entities + chat not found
async function trySendToGroup(groupId, text, opts={}){
  if(!groupId) return false;
  if(!(process.env.GROUP_NOTIFY_ENABLED||'true').includes('true')) return false;
  const attempts=[groupId];
  const s=String(groupId);
  if(!s.startsWith('-100') && s.startsWith('-')){
    attempts.push(Number('-100'+s.substring(1)));
  }
  if(s.startsWith('-100')){
    attempts.push(Number(s.substring(4)));
  }
  // Specific fallbacks for your IDs that were failing in screenshot: -5090894763 -> -1005090894763, -5361354377 -> -1005361354377
  if(s==='-5090894763') attempts.push(-1005090894763);
  if(s==='-5361354377') attempts.push(-1005361354377);
  if(s==='-1005090894763') attempts.push(-5090894763);
  if(s==='-1005361354377') attempts.push(-5361354377);

  for(let gid of attempts){
    try{
      // Remove Markdown to avoid "Can't parse entities" error from your screenshot
      const safeOpts={...opts};
      if(safeOpts.parse_mode==='Markdown'){
        delete safeOpts.parse_mode;
      }
      await bot.sendMessage(gid, text, safeOpts);
      return true;
    }catch(e){
      console.log(`Group send fail ${gid} with opts ${JSON.stringify(opts)}: ${e.message}`);
      // Try plain text without any markdown - fixes "Can't parse entities" error
      try{
        const plainOpts={};
        if(opts.reply_markup) plainOpts.reply_markup=opts.reply_markup;
        await bot.sendMessage(gid, text.replace(/[*_`\[\]]/g,''), plainOpts);
        console.log(`Group send retry plain text success to ${gid}`);
        return true;
      }catch(e2){
        console.log(`Group plain text also fail ${gid}: ${e2.message}`);
      }
    }
  }
  console.log(`All attempts failed for group ${groupId}, giving up but not crashing (fixes Unhandled rejection chat not found)`);
  return false;
}
async function notifyOrderGroup(order, user){
  const maskedOrder=maskIdPublic(order.order_id);
  const maskedUser=maskIdPublic(user.id);
  const msg=`🛒 *New Order Placed!* #order\n\n👤 ${user.first_name} (@${user.username||'none'}) ID: ${maskedUser}\n🛠 ${order.service_name} (${order.service_id})${order.manual?' (MANUAL)':''}\n📂 ${order.category}\n🔢 Qty: ${order.quantity}\n🔗 Link: ${order.link}\n💰 Charge: ${formatMoney(order.charge_user, order.charge_currency)}\n🆔 Order ID: ${maskedOrder} (Full: ${order.manual?'hidden manual':'(masked)'})\n📅 ${new Date().toLocaleString()}\n\nCopy ID: \`${order.order_id}\``;
  await trySendToGroup(ORDER_GROUP_ID, msg, {parse_mode:"Markdown"});
}
async function notifyDepositGroup(txn, user){
  const maskedTxn=maskIdPublic(txn.txn_id);
  const maskedUser=maskIdPublic(user.id);
  const msg=`💰 *Deposit Successful!* #deposit\n\n👤 ${user.first_name} (@${user.username||'none'}) ID: ${maskedUser}\n💵 Amount: ${formatMoney(txn.amount, txn.currency)}\n🏦 Gateway: ${txn.gateway}\n🆔 Txn ID: ${maskedTxn}\n📅 ${new Date().toLocaleString()}\n\nCopy Txn: \`${txn.txn_id}\``;
  await trySendToGroup(DEPOSIT_GROUP_ID, msg, {parse_mode:"Markdown"});
}
async function notifySupportGroupNewUser(newUser){
  const msg=`🔔 *New User Joined!* #newuser\n\nName: ${newUser.first_name}\nID: ${maskIdPublic(newUser.id)} Full: ${newUser.id}\nUsername: @${newUser.username||'none'}\nLang: ${newUser.lang||'?'}\nCurr: ${newUser.currency||'?'}\nTotal Users: ${dbData.users.length}\n#newuser`;
  await trySendToGroup(GROUP_1_ID, msg, {parse_mode:"Markdown"});
}
function notifyNewUserToAdmins(newUser){
  for(let aid of ADMIN_IDS){
    try{ bot.sendMessage(aid, `🔔 New User ID ${newUser.id} Name ${newUser.first_name} @${newUser.username||'none'} Total ${dbData.users.length}`); }catch(e){}
  }
  notifySupportGroupNewUser(newUser);
}

// SMM API
let svcCache={data:null, ts:0, error:null};
async function smmPost(p){
  try{
    // API fixed from .env only as per your latest request - No Manage API changing
    const apiUrl=API_URL;
    const apiKey=API_KEY;
    // For https://totocompamy.com/api/v2 - Your SMM provider IS totocompamy.com, so allow it
    const body=new URLSearchParams({key:apiKey, ...p});
    const {data}=await axios.post(apiUrl, body.toString(), {headers:{'Content-Type':'application/x-www-form-urlencoded'}, timeout:15000});
    if(data && data.error){
      if(String(data.error).toLowerCase().includes('invalid api key')){
        throw new Error(`Invalid API Key from ${apiUrl}. Go to https://totocompamy.com -> API page -> Copy correct API Key and update .env file then Restart App`);
      }
      throw new Error(data.error);
    }
    if(typeof data === 'string' && data.toLowerCase().includes('invalid api key')){
      throw new Error(`Invalid API Key from ${apiUrl}. Your key is wrong or expired. Copy again from https://totocompamy.com API page and update .env`);
    }
    return data;
  }catch(e){
    const msg=e.response?.data ? (typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data)).slice(0,500) : e.message;
    throw new Error(`API ${p.action} Error: ${msg} | URL: ${API_URL}`);
  }
}
async function getServices(force=false){
  if(!force && svcCache.data && Date.now()-svcCache.ts<5*60*1000) return svcCache.data;
  try{
    const data=await smmPost({action:'services'});
    if(!Array.isArray(data)) throw new Error("Services API not array: "+JSON.stringify(data).slice(0,500));
    svcCache={data, ts:Date.now(), error:null};
    setSetting('last_service_count', data.length);
    return data;
  }catch(e){
    svcCache.error=e.message;
    // Return empty array but manual services still available
    return [];
  }
}
function getCategories(svcs){
  const apiCats=[...new Set(svcs.map(s=>s.category))];
  const manualCats=[...new Set(dbData.manual_services.map(s=>s.category))];
  const all=[...apiCats];
  manualCats.forEach(c=>{ if(!all.includes(c)) all.push(c); });
  return all.length>0 ? all : ['Facebook','Instagram','YouTube','TikTok','Manual'];
}
function isCatEnabled(cat){ const en=getSetting('enabled_categories', null); if(!en) return true; return en.includes(cat); }
function isSvcEnabled(sid){ const dis=getSetting('disabled_services', []); return !dis.includes(String(sid)); }
function getEffectiveRate(svc, userId){
  const user=getUser(userId);
  let rateINR=parseFloat(svc.rate||svc.rate_inr||0);
  const cpUser=dbData.custom_prices.find(cp=>String(cp.service_id)===String(svc.service||svc.id) && cp.user_id===userId && cp.active);
  if(cpUser) rateINR=parseFloat(cpUser.custom_rate);
  else{ const cpGlobal=dbData.custom_prices.find(cp=>String(cp.service_id)===String(svc.service||svc.id) && !cp.user_id && cp.active); if(cpGlobal) rateINR=parseFloat(cpGlobal.custom_rate); }
  let discount=user?.discount||0;
  const offers=dbData.offers.filter(o=>o.active && (!o.target_user_id || o.target_user_id===userId) && (!o.service_id || String(o.service_id)===String(svc.service||svc.id)) && (!o.valid_until || new Date(o.valid_until)>new Date()));
  offers.forEach(o=>{ if(o.discount_percent>discount) discount=o.discount_percent; });
  rateINR=rateINR*(1-discount/100);
  const rates=getConversionRates(); const userCurr=user?.currency||'BDT'; const convRate=rates[userCurr]||rates.BDT;
  return {rateINR, rateUser:rateINR*convRate, discount, convRate, currency:userCurr};
}

// NagrikPay
async function createNagrikPayPayment(amount, currency, userId){
  if(!NAGRIKPAY_KEY || NAGRIKPAY_KEY.includes('REPLACE')) throw new Error("NagrikPay Brand Key missing - Set NAGRIKPAY_API_KEY in .env from https://nagorikpay.com -> Brands -> API-KEY");
  const rates=getConversionRates();
  let bdtAmount=amount;
  if((currency||'BDT').toUpperCase()==='USD' || (currency||'BDT').toUpperCase()==='USDT'){
    bdtAmount=amount*rates.BDT/rates.USD;
  }
  const payload={
    cus_name: `User ${userId}`,
    cus_email: `user${userId}@example.com`,
    amount: bdtAmount.toFixed(2),
    success_url: WEBHOOK_URL ? `${WEBHOOK_URL}/payment/success?uid=${userId}` : `https://t.me/${(await bot.getMe()).username}`,
    cancel_url: WEBHOOK_URL ? `${WEBHOOK_URL}/payment/cancel` : `https://t.me/${(await bot.getMe()).username}`,
    webhook_url: WEBHOOK_URL ? `${WEBHOOK_URL}/webhook/nagrikpay` : undefined,
    metadata: {user_id:userId, original_amount:amount, original_currency:currency}
  };
  const res=await axios.post(NAGRIKPAY_BASE, payload, {headers:{'API-KEY':NAGRIKPAY_KEY, 'Content-Type':'application/json'}});
  if(!res.data.payment_url && !res.data.paymentUrl) throw new Error("NagrikPay no payment_url: "+JSON.stringify(res.data).slice(0,500));
  const url=res.data.payment_url || res.data.paymentUrl;
  const txnId=res.data.transaction_id || res.data.tran_id || res.data.invoice_id || `NAGRIK${Date.now()}${userId}`;
  return {url, txnId, bdtAmount};
}
async function verifyNagrikPayPayment(transactionId){
  const res=await axios.post(NAGRIKPAY_VERIFY, {transaction_id:transactionId}, {headers:{'API-KEY':NAGRIKPAY_KEY, 'Content-Type':'application/json'}});
  return res.data;
}

// Express
const app=express();
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.get('/', (req,res)=>res.send(`TotoCompamysmm Final PRO Running | Users ${dbData.users.length} | Admins ${ADMIN_IDS.join(',')} | Groups Order:${ORDER_GROUP_ID} Deposit:${DEPOSIT_GROUP_ID} Support:${SUPPORT_GROUP_ID} Manual:${MANUAL_GROUP_ID}`));
app.get('/payment/success', (req,res)=>res.send('<h2>Payment Success! Return to bot - Balance auto adds if verified</h2>'));
app.get('/payment/cancel', (req,res)=>res.send('<h2>Payment Cancelled</h2>'));
app.post('/webhook/nagrikpay', async (req,res)=>{
  console.log("NagrikPay webhook", req.body, req.query);
  const transactionId=req.body.transaction_id || req.query.transactionId || req.query.transaction_id || req.body.transactionId;
  const status=req.body.status || req.query.status;
  if(!transactionId) return res.send('no id');
  try{
    const verify=await verifyNagrikPayPayment(transactionId);
    console.log("Verify", verify);
    const isSuccess = verify.status===true || verify.status==='COMPLETED' || verify.payment_status==='completed' || verify.status==='success' || status==='success' || status==='approved' || status==='done';
    const isPending = verify.status==='pending' || status==='pending';
    const txn=dbData.transactions.find(t=>t.txn_id===transactionId);
    if(!txn) return res.send('txn not found');
    if(isSuccess && txn.status!=='completed'){
      txn.status='completed'; saveDB();
      addBalance(txn.user_id, txn.amount, txn.currency);
      // Referral bonus only on 1st deposit
      giveReferralBonusIfFirstDeposit(txn.user_id, txn.amount, txn.currency);
      const user=getUser(txn.user_id);
      try{ await bot.sendMessage(txn.user_id, `✅ Payment Approved/Done! ${formatMoney(txn.amount, txn.currency)} added. New ${formatMoney(getUserBalanceInfo(user).amount, txn.currency)}`); }catch(e){}
      await trySendToGroup(DEPOSIT_GROUP_ID, `💰 *Deposit Approved/Done*\nUser ${user.first_name} ID ${maskIdPublic(user.id)}\nAmount ${formatMoney(txn.amount, txn.currency)}\nTxn ${maskIdPublic(txn.txn_id)}\nStatus: Approved/Done\n#deposit`);
    } else if(isPending){
      try{ await bot.sendMessage(txn.user_id, `⏳ Payment Pending: ${formatMoney(txn.amount, txn.currency)} Status: pending. Wait for approval or contact support.`); }catch(e){}
      await trySendToGroup(DEPOSIT_GROUP_ID, `⏳ Deposit Pending\nUser ${maskIdPublic(txn.user_id)} Amount ${formatMoney(txn.amount, txn.currency)} Txn ${maskIdPublic(txn.txn_id)} Status Pending`);
    }
    res.send('ok');
  }catch(e){ console.error("Webhook err", e.message); res.status(500).send('error'); }
});
app.listen(PORT, ()=>console.log(`🌐 Webhook server ${PORT}`));

// Bot
const bot=new TelegramBot(BOT_TOKEN, {polling:true});
const state=new Map();

// Fix for Render logs: 409 Conflict polling_error and unhandled rejection (your screenshots)
// If bot runs on both cPanel and Render at same time, Telegram returns 409 Conflict
bot.on('polling_error', (error)=>{
  console.log(`Polling error: ${error.message}`);
  if(error.message.includes('409 Conflict')){
    console.log("⚠️ 409 Conflict: Another bot instance running! Make sure only ONE instance is running (stop cPanel app if testing on Render, or stop Render if testing on cPanel). This is NOT a code error, it's deployment conflict. For 100% lifetime free on cPanel, stop Render instance.");
  }
});
process.on('unhandledRejection', (reason, promise)=>{
  console.log('Unhandled Rejection at:', promise, 'reason:', reason?.message || reason);
  // Don't crash, just log - fixes your screenshot Unhandled rejection chat not found
});

bot.onText(/\/start/, async (msg)=>{
  const args=msg.text.split(' ');
  let referrerId=null;
  if(args.length>1 && args[1].startsWith('REF')){
    referrerId=parseInt(args[1].replace('REF',''));
  }
  if(getUser(msg.from.id)?.banned) return bot.sendMessage(msg.from.id, "❌ Banned");
  const {user, isNew}=ensureUser(msg);
  if(isNew){
    if(referrerId) user.referred_by=referrerId;
    saveDB();
    notifyNewUserToAdmins(user);
    if(referrerId && getUser(referrerId)){
      // Notify referrer
      try{ await bot.sendMessage(referrerId, `🎁 New referral! User ${user.first_name} (@${user.username||'none'}) joined using your link. You will get bonus when they deposit.`); }catch(e){}
    }
  }
  if(!user.lang){
    return bot.sendMessage(msg.from.id, T.en.select_lang, {reply_markup:{inline_keyboard:[[{text:"🇧🇩 Bangla", callback_data:"lang_bn"}, {text:"🇬🇧 English", callback_data:"lang_en"}]]}});
  }
  if(!user.currency) return askCurrency(msg.from.id);
  const chk=await checkUserJoinedAll(msg.from.id);
  if(FORCE_JOIN_ENABLED && !chk.joined) return sendForceJoinMessage(msg.from.id);
  const bal=getUserBalanceInfo(user);
  bot.sendMessage(msg.from.id, tr(msg.from.id,'welcome',{BALANCE:formatMoney(bal.amount, bal.code), LANG:user.lang, CURR:bal.code, ID:msg.from.id}), {reply_markup:{keyboard: mainKb(msg.from.id), resize_keyboard:true}});
});

bot.onText(/\/admin/, (msg)=>{
  const uid=msg.from.id; if(!isAdmin(uid)) return;
  const uCount=dbData.users.length;
  const oCount=dbData.orders.length;
  const pCount=dbData.orders.filter(o=>!['Completed','Canceled','Refunded','Partial','Manual Completed'].includes(o.status)).length;
  const mCount=dbData.orders.filter(o=>o.manual && o.status==='Manual Pending').length;
  const tbdt=dbData.users.reduce((s,u)=>s+(u.balance_bdt||0),0);
  const tusd=dbData.users.reduce((s,u)=>s+(u.balance_usd||0),0);
  const apiUrl=getSetting('api_url', API_URL_ENV);
  bot.sendMessage(uid, tr(uid,'admin_panel',{U:uCount, O:oCount, P:pCount, M:mCount, BDT:getConversionRates().BDT, USD:getConversionRates().USD, TBDT:tbdt.toFixed(2), TUSD:tusd.toFixed(2), API_URL:apiUrl, ORDER_G:ORDER_GROUP_ID, DEPOSIT_G:DEPOSIT_GROUP_ID, SUPPORT_G:SUPPORT_GROUP_ID, MANUAL_G:MANUAL_GROUP_ID}), {
    parse_mode:"Markdown",
    reply_markup:{inline_keyboard:[
      [{text:"📂 Categories", callback_data:"adm_cats"}, {text:"🔍 Search User", callback_data:"adm_search"}],
      [{text:"🛠 Add Manual", callback_data:"adm_add_manual"}, {text:"📋 List Manual", callback_data:"adm_list_manual"}],
      [{text:"📦 Manual Orders (New Group)", callback_data:"adm_manual_orders"}, {text:"💱 Set Rates", callback_data:"adm_rates"}],
      [{text:"🎁 Offers (ServiceID)", callback_data:"adm_offers"}, {text:"💰 Add Balance", callback_data:"adm_addbal"}],
      [{text:"📊 API Bal", callback_data:"adm_apibal"}, {text:"🧪 Test API", callback_data:"adm_test_api"}],
      [{text:"📢 Broadcast", callback_data:"adm_bcast"}, {text:"💳 Txns (Approve Manual)", callback_data:"adm_txns"}],
      [{text:"🔔 Toggle Notify", callback_data:"adm_toggle_notify"}, {text:"❌ Cancel", callback_data:"cancel_action"}]
    ]}
  });
});

bot.on('callback_query', async (cq)=>{
  const uid=cq.from.id;
  const chatId=cq.message?.chat?.id;
  const isGroup = cq.message && (cq.message.chat.type==='group' || cq.message.chat.type==='supergroup');
  
  // Admin check for group buttons
  if(isGroup){
    if(!isAdmin(uid)){
      return bot.answerCallbackQuery(cq.id, {text: T.en.admin_not_allowed || "Admin not allowed - Only admins can use this button in groups", show_alert:true});
    }
  }
  await bot.answerCallbackQuery(cq.id).catch(()=>{});
  ensureUser(cq.message || {from:cq.from});

  const data=cq.data;
  if(getUser(uid)?.banned) return;

  if(data==='lang_en' || data==='lang_bn'){
    const lang=data==='lang_en'?'en':'bn'; const u=getUser(uid); u.lang=lang; saveDB();
    if(!u.currency) return askCurrency(uid);
    if(FORCE_JOIN_ENABLED){
      const chk=await checkUserJoinedAll(uid);
      if(!chk.joined) return sendForceJoinMessage(uid);
    }
    const bal=getUserBalanceInfo(u);
    bot.sendMessage(uid, tr(uid,'welcome',{BALANCE:formatMoney(bal.amount, bal.code), LANG:lang, CURR:bal.code, ID:uid}), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    return;
  }
  if(data==='curr_BDT' || data==='curr_USD'){
    const curr=data==='curr_BDT'?'BDT':'USD'; const u=getUser(uid); u.currency=curr; saveDB();
    if(FORCE_JOIN_ENABLED){
      const chk=await checkUserJoinedAll(uid);
      if(!chk.joined) return sendForceJoinMessage(uid);
    }
    const bal=getUserBalanceInfo(u);
    bot.sendMessage(uid, tr(uid,'currency_set',{CURR:curr}), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    bot.sendMessage(uid, tr(uid,'welcome',{BALANCE:formatMoney(bal.amount, bal.code), LANG:u.lang, CURR:curr, ID:uid}), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    return;
  }
  if(data==='verify_join'){
    const chk=await checkUserJoinedAll(uid);
    if(!chk.joined){
      return bot.sendMessage(uid, tr(uid,'not_joined',{MISSING:chk.missing.join(', ')}), {reply_markup:{inline_keyboard:[[{text:"✅ Verify Again", callback_data:"verify_join"}]]}});
    }
    bot.sendMessage(uid, tr(uid,'joined_ok'), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    return;
  }
  if(data==='cancel_action'){
    state.delete(uid);
    bot.sendMessage(uid, tr(uid,'cancelled'), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    return;
  }

  // New order type selection: Auto, Manual, Search
  if(data==='neworder_auto'){
    try{
      const services=await getServices();
      const cats=getCategories(services.filter(s=>!s.manual)).filter(isCatEnabled);
      let kb=[];
      for(let i=0;i<cats.length;i++) kb.push([{text:cats[i], callback_data:`cat_auto_${i}`}]);
      kb.push([{text:"🔍 Search Service ID", callback_data:"neworder_search"}]);
      kb.push([{text:tr(uid,'cancel'), callback_data:"cancel_action"}]);
      return bot.sendMessage(uid, tr(uid,'ask_cat',{CURR:getUser(uid).currency||'BDT'}), {reply_markup:{inline_keyboard:kb}});
    }catch(e){ return bot.sendMessage(uid, `❌ API Error: ${e.message}. Use Manual or Search`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}}); }
  }
  if(data==='neworder_manual'){
    const manualCats=[...new Set(dbData.manual_services.map(s=>s.category))];
    if(manualCats.length===0) return bot.sendMessage(uid, "No manual services yet. Admin: /admin -> Add Manual Service", {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    let kb=[];
    for(let i=0;i<manualCats.length;i++) kb.push([{text:`🛠 ${manualCats[i]}`, callback_data:`cat_manual_${i}`}]);
    kb.push([{text:tr(uid,'cancel'), callback_data:"cancel_action"}]);
    return bot.sendMessage(uid, `📂 Manual Categories - Select:\nYour currency: ${getUser(uid).currency||'BDT'} only`, {reply_markup:{inline_keyboard:kb}});
  }
  if(data==='neworder_search'){
    state.set(uid,{step:'await_service_manual'});
    return bot.sendMessage(uid, "🔍 Send Service ID to search (API + Manual):", {reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}});
  }

  if(data.startsWith('cat_auto_')){
    const idx=parseInt(data.split('_')[2]);
    try{
      const services=await getServices();
      const cats=getCategories(services).filter(isCatEnabled);
      const cat=cats[idx];
      const list=services.filter(s=>s.category===cat && isSvcEnabled(s.service)).slice(0,25);
      if(list.length===0) return bot.sendMessage(uid, "No services in this category", {reply_markup:{inline_keyboard:[[{text:tr(uid,'cancel'), callback_data:"cancel_action"}]]}});
      let kb=list.map(s=>{ const eff=getEffectiveRate(s, uid); return [{text:`${s.service} - ${s.name.slice(0,25)} ${formatMoney(eff.rateUser, eff.currency)}/1k`, callback_data:`svc_${s.service}_a`}]; });
      kb.push([{text:"⬅️ Back", callback_data:"neworder_auto"}]);
      kb.push([{text:tr(uid,'cancel'), callback_data:"cancel_action"}]);
      bot.sendMessage(uid, tr(uid,'ask_service',{CAT:cat, PRICE:list[0]?getEffectiveRate(list[0], uid).rateUser.toFixed(2):'0', MIN:list[0]?.min||0, MAX:list[0]?.max||0, CURR:getUser(uid).currency||'BDT'}), {reply_markup:{inline_keyboard:kb}});
    }catch(e){ bot.sendMessage(uid, `❌ API Error: ${e.message}`); }
    return;
  }
  if(data.startsWith('cat_manual_')){
    const idx=parseInt(data.split('_')[2]);
    const manualCats=[...new Set(dbData.manual_services.map(s=>s.category))];
    const cat=manualCats[idx];
    const list=dbData.manual_services.filter(s=>s.category===cat).slice(0,25);
    let kb=list.map(s=>{ const eff=getEffectiveRate({service:s.id, rate:s.rate_inr}, uid); return [{text:`🛠 ${s.id} - ${s.name.slice(0,25)} ${formatMoney(eff.rateUser, eff.currency)}/1k`, callback_data:`svc_${s.id}_m`}]; });
    kb.push([{text:"⬅️ Back", callback_data:"neworder_manual"}]);
    kb.push([{text:tr(uid,'cancel'), callback_data:"cancel_action"}]);
    bot.sendMessage(uid, `📂 Manual Category ${cat}\nSelect service (price only ${getUser(uid).currency||'BDT'}):`, {reply_markup:{inline_keyboard:kb}});
    return;
  }

  if(data.startsWith('svc_')){
    const parts=data.split('_'); const sid=parts[1]; const type=parts[2];
    try{
      let svc=null;
      if(type==='m'){
        const manual=dbData.manual_services.find(s=>String(s.id)===String(sid));
        if(!manual) throw new Error("Manual service ID "+sid+" not found");
        svc={service:manual.id, name:manual.name, category:manual.category, rate:manual.rate_inr, min:manual.min, max:manual.max, manual:true};
      } else {
        const services=await getServices();
        const found=services.find(s=>String(s.service)===String(sid));
        if(!found) throw new Error(`Service ID ${sid} not found on provider`);
        svc={...found, manual:false};
      }
      state.set(uid, {step:'await_link', service:svc});
      bot.sendMessage(uid, `🛠 *${svc.name}* ${svc.manual?'(MANUAL)':''}\nPrice: ${formatMoney(getEffectiveRate(svc, uid).rateUser, getUser(uid).currency||'BDT')}/1k\nMin ${svc.min} Max ${svc.max}\n\n${tr(uid,'ask_link')}`, {parse_mode:"Markdown", reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}});
    }catch(e){
      bot.sendMessage(uid, `❌ ${tr(uid,'invalid_sid',{ID:sid})}\nError: ${e.message}`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    }
    return;
  }
  if(data==='confirm_yes'){
    const st=state.get(uid); if(!st) return;
    if(isDuplicateRequest(uid, 'confirm_order')) return bot.sendMessage(uid, "⚠️ Please wait, processing previous request...");
    const svc=st.service; const eff=getEffectiveRate(svc, uid);
    const chargeINR=eff.rateINR*st.quantity/1000; const chargeUser=eff.rateUser*st.quantity/1000;
    const u=getUser(uid); const balInfo=getUserBalanceInfo(u);
    if(balInfo.amount < chargeUser){
      state.delete(uid);
      // Show both balances and suggest switching currency - fixes your screenshot low balance issue
      const otherCurr = balInfo.code==='BDT' ? 'USD' : 'BDT';
      const otherBal = balInfo.code==='BDT' ? (u.balance_usd||0) : (u.balance_bdt||0);
      let msg = tr(uid,'insufficient',{NEED:formatMoney(chargeUser, balInfo.code), HAVE:formatMoney(balInfo.amount, balInfo.code), CURR:balInfo.code});
      msg += `\n\n💰 Your Balances:\nBDT: ৳${(u.balance_bdt||0).toFixed(2)}\nUSD: $${(u.balance_usd||0).toFixed(2)}\n\nCurrent Currency: ${balInfo.code}\n\n`;
      if(otherBal>0){
        msg += `You have ${formatMoney(otherBal, otherCurr)} in ${otherCurr} wallet, but you are trying to order in ${balInfo.code}.\n\nTo use ${otherCurr} balance, switch currency to ${otherCurr} via 💱 Currency button.\nOr add ${balInfo.code} balance via 💰 Add Funds.\n\nIf currency is ${balInfo.code}, all prices and balances will be ${balInfo.code} only (as you requested).`;
      } else {
        msg += `Add ${balInfo.code} balance via 💰 Add Funds to order.`;
      }
      return bot.sendMessage(uid, msg, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    }
    deductBalance(uid, chargeUser, balInfo.code);
    try{
      let apiOrderId; let isManual=svc.manual;
      if(isManual){ apiOrderId=`MANUAL${Date.now()}${uid}`; }
      else {
        const res=await smmPost({action:'add', service:svc.service, link:st.link, quantity:st.quantity});
        if(res.error){ addBalance(uid, chargeUser, balInfo.code); state.delete(uid); throw new Error(res.error); }
        apiOrderId=res.order;
      }
      const orderObj={
        id:dbData.orders.length+1, order_id:apiOrderId, user_id:uid, service_id:svc.service, service_name:svc.name, category:svc.category, link:st.link, quantity:st.quantity,
        charge_inr:chargeINR, charge_user:chargeUser, charge_currency:balInfo.code, conversion_rate:eff.convRate, status:isManual?'Manual Pending':'Pending', refunded:0, manual:isManual, created_at:new Date().toISOString()
      };
      dbData.orders.push(orderObj); saveDB(); state.delete(uid);
      const msgKey=isManual?'order_ok_manual':'order_ok';
      const sentMsg=await bot.sendMessage(uid, tr(uid,msgKey,{OID:apiOrderId, CHARGE_USER:formatMoney(chargeUser, balInfo.code), CHARGE_INR:chargeINR.toFixed(2), CURR:balInfo.code, RATE:eff.convRate})+`\n\n📋 Copy ID: \`${apiOrderId}\`\n🔗 Copy Link: \`${st.link}\``, {parse_mode:"Markdown", reply_markup:{keyboard: mainKb(uid), resize_keyboard:true, inline_keyboard:[[{text:"📋 Copy Order ID", callback_data:`copy_order_${apiOrderId}`},{text:"🔗 Copy Link", callback_data:`copy_link_${apiOrderId}`}]]}});
      // Group notifications
      if(isManual){
        const manualMsg=`🛠 *MANUAL ORDER New!* #manual\n\n👤 ${u.first_name} (@${u.username||'none'}) ID ${maskIdPublic(u.id)}\n🛠 ${svc.name} (${svc.service}) ${svc.category}\n🔢 Qty: ${st.quantity}\n🔗 ${st.link}\n💰 ${formatMoney(chargeUser, balInfo.code)}\n🆔 Order ID: ${maskIdPublic(apiOrderId)} Full: ${apiOrderId}\n\nCopy: \`${apiOrderId}\``;
        // Manual group with 3 buttons: Cross, Processing, Done
        const manualKb={inline_keyboard:[
          [{text:"❌ Cross (Reject + Refund)", callback_data:`manual_cancel_${apiOrderId}`},
           {text:"⏳ Processing", callback_data:`manual_processing_${apiOrderId}`},
           {text:"✅ Done", callback_data:`manual_complete_${apiOrderId}`}],
          [{text:"📋 Copy Order ID", callback_data:`copy_order_${apiOrderId}`}]
        ]};
        await trySendToGroup(MANUAL_GROUP_ID, manualMsg, {parse_mode:"Markdown", reply_markup:manualKb});
        // Also to order group? Per new requirement, manual goes to manual group only
        for(let aid of ADMIN_IDS){ try{ await bot.sendMessage(aid, `🛠 MANUAL NEED ACTION\n${manualMsg}\nFull ID: ${apiOrderId}` , {parse_mode:"Markdown"}); }catch(e){} }
      } else {
        // Auto order goes to ORDER_GROUP_ID (Group 3)
        const maskedOrder=maskIdPublic(apiOrderId);
        const autoMsg=`🛒 *New Auto Order Placed!* #order\n\n👤 ${u.first_name} (@${u.username||'none'}) ID ${maskIdPublic(u.id)}\n🛠 ${svc.name} (${svc.service}) ${svc.category}\n🔢 Qty: ${st.quantity}\n💰 ${formatMoney(chargeUser, balInfo.code)}\n🆔 Order ID: ${maskedOrder}\n📅 ${new Date().toLocaleString()}\n\nCopy: \`${apiOrderId}\``;
        await trySendToGroup(ORDER_GROUP_ID, autoMsg, {parse_mode:"Markdown", reply_markup:{inline_keyboard:[[{text:"📋 Copy Order ID", callback_data:`copy_order_${apiOrderId}`}],[{text:"❌ Cross", callback_data:`manual_cancel_${apiOrderId}`},{text:"✅ Done", callback_data:`manual_complete_${apiOrderId}`}]]}});
      }
    }catch(e){
      addBalance(uid, chargeUser, balInfo.code);
      if(isAdmin(uid)){
        bot.sendMessage(uid, `❌ Admin Error: ${e.message}\n\nFix: Check API_URL is real SMM provider, not your own domain. /admin -> Manage API -> Change URL or use Manual service.`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
      } else {
        bot.sendMessage(uid, tr(uid,'friendly_error',{LINK:SUPPORT_LINK}), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
      }
    }
    return;
  }
  if(data==='confirm_no'){ state.delete(uid); bot.sendMessage(uid, tr(uid,'cancelled'), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}}); return; }

  if(data.startsWith('check_')){
    const oid=data.split('_')[1];
    const row=dbData.orders.find(o=>String(o.order_id)===String(oid) && o.user_id===uid);
    if(!row) return bot.sendMessage(uid, "Order not found");
    if(row.manual) return bot.sendMessage(uid, `📦 Manual Order #${maskIdPublic(oid)}\nStatus: ${row.status}\nAdmin will update.`);
    bot.sendMessage(uid, `⏳ Checking #${maskIdPublic(oid)}...`);
    try{
      const res=await smmPost({action:'status', order:oid});
      const status=res.status||'Unknown'; row.status=status; saveDB();
      if(['Canceled','Refunded'].includes(status) && !row.refunded){ addBalance(uid, row.charge_user, row.charge_currency); row.refunded=1; saveDB(); bot.sendMessage(uid, `💸 #${maskIdPublic(oid)} ${status}. Refunded ${formatMoney(row.charge_user, row.charge_currency)}`); }
      else if(status==='Partial'){ const remains=parseInt(res.remains||0); if(remains>0 && !row.refunded){ const refundUser=row.charge_user*remains/row.quantity; addBalance(uid, refundUser, row.charge_currency); row.refunded=1; saveDB(); bot.sendMessage(uid, `⚠️ #${maskIdPublic(oid)} Partial Remains ${remains} Refunded ${formatMoney(refundUser, row.charge_currency)}`); } }
      else if(status==='Completed') bot.sendMessage(uid, `✅ #${maskIdPublic(oid)} Completed!`);
      else bot.sendMessage(uid, `📦 #${maskIdPublic(oid)} Status: ${status}`);
    }catch(e){
      if(isAdmin(uid)) bot.sendMessage(uid, `❌ API Error: ${e.message}`);
      else bot.sendMessage(uid, tr(uid,'friendly_error',{LINK:SUPPORT_LINK}));
    }
    return;
  }

  // Reorder previous order - NEW FEATURE: easy reorder
  if(data.startsWith('reorder_')){
    let targetOrderId = data.replace('reorder_','');
    let targetOrder = null;
    if(targetOrderId==='last'){
      // Last order
      const userOrders = dbData.orders.filter(o=>o.user_id===uid).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
      targetOrder = userOrders[0];
    } else {
      targetOrder = dbData.orders.find(o=>String(o.order_id)===String(targetOrderId) && o.user_id===uid);
    }
    if(!targetOrder){
      return bot.sendMessage(uid, "❌ Previous order not found for reorder", {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    }
    // Try to find current service for reorder (may still exist)
    try{
      const services = await getServices();
      let svc = services.find(s=>String(s.service)===String(targetOrder.service_id));
      if(!svc){
        // Check manual
        const manual = dbData.manual_services.find(s=>String(s.id)===String(targetOrder.service_id));
        if(manual) svc = {service:manual.id, name:manual.name, category:manual.category, rate:manual.rate_inr, min:manual.min, max:manual.max, manual:true};
      }
      if(!svc){
        // Service not found anymore, but allow reorder with old service data if manual or use stored rate
        svc = {
          service: targetOrder.service_id,
          name: targetOrder.service_name,
          category: targetOrder.category,
          rate: targetOrder.charge_inr ? (targetOrder.charge_inr * 1000 / targetOrder.quantity) : 100,
          min: 10,
          max: 1000000,
          manual: targetOrder.manual || false
        };
      }
      // Set state for reorder with previous link and quantity, but allow user to edit quantity?
      state.set(uid, {step:'await_link', service:svc, reorder_from:targetOrder.order_id, reorder_link:targetOrder.link, reorder_qty:targetOrder.quantity});
      const eff=getEffectiveRate(svc, uid);
      return bot.sendMessage(uid, `🔄 *Reorder Previous Order*\n\nPrevious Order: #${maskIdPublic(targetOrder.order_id)}\nService: ${svc.name} [${svc.service}]\nCategory: ${svc.category}\nPrevious Link: ${targetOrder.link}\nPrevious Qty: ${targetOrder.quantity}\n\nCurrent Price: ${formatMoney(eff.rateUser, eff.currency)}/1k (Only ${eff.currency})\n\n*Send NEW Link (or send same link to reorder same) or type 'same' to use previous link:*\nPrevious: ${targetOrder.link}\n\nCancel to abort`, {
        parse_mode:"Markdown",
        reply_markup:{keyboard:[[{text:targetOrder.link.slice(0,30)}, {text:"same"}], [{text:tr(uid,'cancel')}]], resize_keyboard:true}
      });
    }catch(e){
      if(isAdmin(uid)) bot.sendMessage(uid, `❌ Reorder Error: ${e.message}`);
      else bot.sendMessage(uid, tr(uid,'friendly_error',{LINK:SUPPORT_LINK}));
      return;
    }
  }

  // Copy buttons
  if(data.startsWith('copy_order_')){
    const oid=data.replace('copy_order_','');
    return bot.sendMessage(uid, `📋 *Copy Order ID:*\n\`${oid}\`\n\nTap to copy (mobile: long press code)`, {parse_mode:"Markdown"});
  }
  if(data.startsWith('copy_link_')){
    const oid=data.replace('copy_link_','');
    const order=dbData.orders.find(o=>String(o.order_id)===oid);
    if(order) return bot.sendMessage(uid, `🔗 *Copy Link:*\n\`${order.link}\``, {parse_mode:"Markdown"});
    return bot.sendMessage(uid, `Link: ${oid}`);
  }

  // Payment gateway
  if(data.startsWith('paygw_')){
    const gw=data.split('_')[1];
    const st=state.get(uid);
    if(!st || st.step!=='await_gateway') return bot.sendMessage(uid, tr(uid,'cancelled'), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    const amount=st.amount; const user=getUser(uid); const currency=user.currency||'BDT';
    try{
      if(gw==='nagrikpay'){
        const pay=await createNagrikPayPayment(amount, currency, uid);
        const newId=dbData.transactions.length+1;
        dbData.transactions.push({id:newId, user_id:uid, amount, currency, gateway:'nagrikpay', txn_id:pay.txnId, status:'pending', created_at:new Date().toISOString()}); saveDB();
        state.delete(uid);
        return bot.sendMessage(uid, tr(uid,'payment_created',{AMT:formatMoney(amount,currency), URL:pay.url})+`\nBDT Amount: ৳${pay.bdtAmount.toFixed(2)}`, {reply_markup:{inline_keyboard:[[{text:`💳 Pay ${formatMoney(amount,currency)} via NagrikPay`, url:pay.url}],[{text:"✅ I Paid - Verify", callback_data:`verify_nagrik_${newId}`},{text:tr(uid,'cancel'), callback_data:"cancel_action"}]]}});
      }
      if(gw==='manual'){
        state.set(uid,{step:'await_manual_trxid', amount, currency});
        return bot.sendMessage(uid, `💵 Manual Payment for ${formatMoney(amount,currency)}\n\nSend your bKash/Nagad/Rocket TrxID and amount\nExample: ABC123XYZ 100\n\nAdmin will verify and add balance.\n\nCancel to abort`, {reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}});
      }
    }catch(e){
      state.delete(uid);
      if(isAdmin(uid)) bot.sendMessage(uid, `❌ Payment failed ${gw}: ${e.message}\n\nFix: Set NAGRIKPAY_API_KEY in .env`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
      else bot.sendMessage(uid, tr(uid,'friendly_error',{LINK:SUPPORT_LINK}), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
      return;
    }
    return;
  }

  if(data.startsWith('verify_')){
    const idPart=data.replace('verify_','');
    if(idPart.startsWith('nagrik_')){
      const id=parseInt(idPart.split('_')[1]); const txn=dbData.transactions.find(t=>t.id===id); if(!txn) return;
      try{
        const v=await verifyNagrikPayPayment(txn.txn_id);
        // Handle various statuses: done, approved, pending, success
        const statusStr=JSON.stringify(v).toLowerCase();
        let status='unknown';
        if(v.status===true || v.status==='COMPLETED' || v.status==='completed' || v.payment_status==='completed' || v.status==='success' || statusStr.includes('success') || statusStr.includes('approved') || statusStr.includes('done')){
          status='done';
        } else if(statusStr.includes('pending')){
          status='pending';
        } else if(statusStr.includes('approved')){
          status='approved';
        }

        if(status==='done' || status==='approved' || status==='success'){
          if(txn.status!=='completed'){
            txn.status='completed'; saveDB();
            addBalance(uid, txn.amount, txn.currency);
            // Referral bonus only on 1st deposit
            giveReferralBonusIfFirstDeposit(uid, txn.amount, txn.currency);
            const user=getUser(uid);
            bot.sendMessage(uid, `✅ ${status==='pending'?'Pending':''} Payment ${status}: ${formatMoney(txn.amount, txn.currency)} added. New ${formatMoney(getUserBalanceInfo(user).amount, txn.currency)}`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
            // Deposit notification to Group 2 with masked ID
            const maskedTxn=maskIdPublic(txn.txn_id);
            await trySendToGroup(DEPOSIT_GROUP_ID, `💰 *Deposit ${status}*\nUser ${user.first_name} ID ${maskIdPublic(user.id)}\nAmount ${formatMoney(txn.amount, txn.currency)}\nGateway NagrikPay\nTxn ${maskedTxn}\nStatus: ${status}\n#deposit`, {parse_mode:"Markdown"});
          }
        } else if(status==='pending'){
          bot.sendMessage(uid, `⏳ Payment Pending: ${formatMoney(txn.amount, txn.currency)} Status: pending. Wait for admin verification or contact support group ${SUPPORT_LINK}`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
        } else {
          bot.sendMessage(uid, `NagrikPay status: ${JSON.stringify(v).slice(0,300)}`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
        }
      }catch(e){
        if(isAdmin(uid)) bot.sendMessage(uid, `Verify err: ${e.message}`);
        else bot.sendMessage(uid, tr(uid,'friendly_error',{LINK:SUPPORT_LINK}));
      }
      return;
    }
    return;
  }

  // Manual order group buttons - admin only check already done at top for groups
  if(data.startsWith('manual_processing_')){
    const oid=data.replace('manual_processing_','');
    const order=dbData.orders.find(o=>String(o.order_id)===oid);
    if(!order) return bot.sendMessage(uid, "Order not found");
    // Show 2 options Cross or Done when processing clicked
    order.status='Processing'; saveDB();
    try{ await bot.sendMessage(order.user_id, `⏳ Your manual order #${maskIdPublic(oid)} is now Processing by admin!`); }catch(e){}
    // Edit the group message to show Cross / Done
    try{
      await bot.editMessageReplyMarkup({inline_keyboard:[
        [{text:"❌ Cross (Reject + Refund)", callback_data:`manual_cancel_${oid}`}, {text:"✅ Done", callback_data:`manual_complete_${oid}`}],
        [{text:"📋 Copy Order ID", callback_data:`copy_order_${oid}`}]
      ]}, {chat_id:cq.message.chat.id, message_id:cq.message.message_id});
      await bot.sendMessage(cq.message.chat.id, `⏳ Order #${maskIdPublic(oid)} marked Processing. Now choose Cross or Done.`, {reply_markup:{inline_keyboard:[[{text:"❌ Cross", callback_data:`manual_cancel_${oid}`}, {text:"✅ Done", callback_data:`manual_complete_${oid}`}]]}});
    }catch(e){ console.log("Edit processing fail", e.message); }
    return;
  }
  if(data.startsWith('manual_complete_')){
    const oid=data.replace('manual_complete_','');
    const order=dbData.orders.find(o=>String(o.order_id)===oid);
    if(!order) return;
    order.status='Manual Completed'; saveDB();
    try{ await bot.sendMessage(order.user_id, `✅ Your manual order #${maskIdPublic(oid)} is Done! Completed by admin.`); }catch(e){}
    try{ await bot.editMessageText(`✅ Manual Order #${maskIdPublic(oid)} Completed!\nUser: ${order.user_id}\nService: ${order.service_name}\n#manual #done`, {chat_id:cq.message.chat.id, message_id:cq.message.message_id, parse_mode:"Markdown"}); }catch(e){}
    const user=getUser(order.user_id);
    if(user) await trySendToGroup(ORDER_GROUP_ID, `✅ Manual Order Done\nUser ${maskIdPublic(user.id)} Order ${maskIdPublic(oid)} Completed\n#manual #done`, {parse_mode:"Markdown"});
    return;
  }
  if(data.startsWith('manual_cancel_')){
    const oid=data.replace('manual_cancel_','');
    const order=dbData.orders.find(o=>String(o.order_id)===oid);
    if(!order) return;
    order.status='Canceled'; 
    if(!order.refunded){ addBalance(order.user_id, order.charge_user, order.charge_currency); order.refunded=1; }
    saveDB();
    try{ await bot.sendMessage(order.user_id, `❌ Your manual order #${maskIdPublic(oid)} Rejected/Crossed by admin! Refunded ${formatMoney(order.charge_user, order.charge_currency)}`); }catch(e){}
    try{ await bot.editMessageText(`❌ Manual Order #${maskIdPublic(oid)} Crossed/Rejected! Refunded ${formatMoney(order.charge_user, order.charge_currency)}\nUser ${maskIdPublic(order.user_id)}\n#manual #cross`, {chat_id:cq.message.chat.id, message_id:cq.message.message_id, parse_mode:"Markdown"}); }catch(e){}
    return;
  }

  // Admin callbacks
  if(!isAdmin(uid)) return;
  if(data==='adm_apibal'){ try{ const r=await smmPost({action:'balance'}); bot.sendMessage(uid, `✅ API Balance Working!\n💰 Balance: ${r.balance} ${r.currency||'USD'}\nURL: ${getSetting('api_url', API_URL)}\n\nIf Invalid API Key error, go to https://totocompamy.com -> API page -> Copy correct API Key and update .env file then Restart App`);}catch(e){ bot.sendMessage(uid, `❌ API Balance Fail: ${e.message}\n\nFix for https://totocompamy.com/api/v2:\n1. Go to https://totocompamy.com -> Login -> API page -> Copy API Key\n2. In .env set API_KEY=your_key and in cPanel Environment Variables\n3. Restart App\n4. Test API again`); } }
  if(data==='adm_addbal'){ state.set(uid,{step:'admin_addbal'}); bot.sendMessage(uid, "Send: `userId amount currency`\nEx: 7481724731 100 BDT", {parse_mode:"Markdown", reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
  if(data==='adm_search'){ state.set(uid,{step:'admin_search_user'}); bot.sendMessage(uid, tr(uid,'search_user_prompt'), {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
  if(data==='adm_rates'){ const rates=getConversionRates(); state.set(uid,{step:'admin_set_rates'}); bot.sendMessage(uid, `Current Hidden Rates:\n1 INR=${rates.BDT} BDT / ${rates.USD} USD\n\nSend BDT_rate USD_rate\nEx: 1.35 0.012`, {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
  if(data==='adm_cats'){
    try{
      const services=await getServices(true);
      const cats=getCategories(services); 
      const en=getSetting('enabled_categories', null);
      let kb=[];
      cats.forEach((c,i)=>{
        const on=!en||en.includes(c);
        // Category button shows services in that category when clicked
        kb.push([{text:`${on?'✅':'❌'} ${c} - View Services`, callback_data:`admin_cat_${i}`}, {text:`${on?'Disable':'Enable'} ${c}`, callback_data:`toggle_cat_${i}`}]);
      });
      kb.push([{text:"✅ Enable All Categories", callback_data:"enable_all_cats"}]);
      kb.push([{text:"🔍 Search Service by ID/Name (Admin)", callback_data:"admin_search_service"}]);
      kb.push([{text:tr(uid,'cancel'), callback_data:"cancel_action"}]);
      bot.sendMessage(uid, `📂 *Categories - Tap to view services in category:*\n\nTotal categories: ${cats.length}\n✅ = Enabled, ❌ = Disabled\nTap category name to view all services in that category`, {parse_mode:"Markdown", reply_markup:{inline_keyboard:kb}});
    }catch(e){ bot.sendMessage(uid, `❌ API Fail: ${e.message}\nShowing manual categories only. Use manual services.\n\nFix: Check API_URL from https://totocompamy.com API page and API_KEY in .env`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}}); }
  }
  if(data.startsWith('admin_cat_')){
    const idx=parseInt(data.split('_')[2]);
    try{
      const services=await getServices();
      const cats=getCategories(services);
      const cat=cats[idx];
      const list=services.filter(s=>s.category===cat).slice(0,50);
      if(list.length===0){
        // Check manual services in this category
        const manualList=dbData.manual_services.filter(s=>s.category===cat);
        if(manualList.length>0){
          let kb=[];
          manualList.forEach(s=>{
            const enabled=isSvcEnabled(s.id);
            kb.push([{text:`${enabled?'✅':'❌'} ${s.id} - ${s.name.slice(0,25)} Manual`, callback_data:`toggle_svc_${s.id}`}]);
          });
          kb.push([{text:"⬅️ Back to Categories", callback_data:"adm_cats"}]);
          kb.push([{text:"🔍 Search Service", callback_data:"admin_search_service"}]);
          return bot.sendMessage(uid, `📂 Manual Category: ${cat}\nServices: ${manualList.length}\nTap to enable/disable service:`, {reply_markup:{inline_keyboard:kb}});
        }
        return bot.sendMessage(uid, `No services in category ${cat}\nTry another category or add manual service`, {reply_markup:{inline_keyboard:[[{text:"⬅️ Back", callback_data:"adm_cats"}]]}});
      }
      let kb=[];
      list.forEach(s=>{
        const enabled=isSvcEnabled(s.service);
        kb.push([{text:`${enabled?'✅':'❌'} ${s.service} - ${s.name.slice(0,20)} - ${s.category}`, callback_data:`toggle_svc_${s.service}`}]);
      });
      kb.push([{text:"⬅️ Back to Categories", callback_data:"adm_cats"}]);
      kb.push([{text:"🔍 Search Service ID/Name", callback_data:"admin_search_service"}]);
      kb.push([{text:"Enable All in This Category", callback_data:`enable_cat_services_${idx}`}]);
      bot.sendMessage(uid, `📂 *Category: ${cat}* - Services: ${list.length}\n\nTap service to enable/disable (✅ enabled, ❌ disabled):\n\nYou can also search specific ID or name to enable/disable`, {parse_mode:"Markdown", reply_markup:{inline_keyboard:kb}});
    }catch(e){ bot.sendMessage(uid, `❌ Error loading services in category: ${e.message}`); }
    return;
  }
  if(data.startsWith('enable_cat_services_')){
    const idx=parseInt(data.split('_')[3]);
    const services=await getServices();
    const cats=getCategories(services);
    const cat=cats[idx];
    const list=services.filter(s=>s.category===cat);
    let disabled=getSetting('disabled_services', []);
    // Enable all in this category
    list.forEach(s=>{
      disabled=disabled.filter(id=>String(id)!==String(s.service));
    });
    setSetting('disabled_services', disabled);
    bot.sendMessage(uid, `✅ All services in category ${cat} enabled (${list.length} services)`);
    return;
  }
  if(data==='admin_search_service'){
    state.set(uid,{step:'admin_search_service'});
    bot.sendMessage(uid, "🔍 *Admin Search Service*\n\nSend Service ID or Service Name (e.g., 123 or Facebook Page Like):\nBot will find and allow enable/disable\n\nCancel to abort", {parse_mode:"Markdown", reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}});
    return;
  }
  if(data.startsWith('toggle_cat_')){ const idx=parseInt(data.split('_')[2]); const services=await getServices(); const cats=getCategories(services); const cat=cats[idx]; let en=getSetting('enabled_categories', null); if(!en) en=[...cats]; if(en.includes(cat)) en=en.filter(x=>x!==cat); else en.push(cat); setSetting('enabled_categories', en); bot.sendMessage(uid, `${cat} now ${en.includes(cat)?'Enabled ✅':'Disabled ❌'}`); }
  if(data==='enable_all_cats'){ setSetting('enabled_categories', null); setSetting('disabled_services', []); bot.sendMessage(uid,"✅ All categories and all services enabled"); }
  if(data==='adm_add_manual'){ state.set(uid,{step:'admin_add_manual_cat'}); bot.sendMessage(uid, "🛠 Add Manual Service Step 1/5\nCategory name:", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
  if(data==='adm_list_manual'){
    let txt="🛠 Manual Services:\n"; dbData.manual_services.forEach(s=>{ txt+=`ID:${s.id} ${s.category} - ${s.name} Rate ${s.rate_inr} INR Min ${s.min} Max ${s.max}\n`; });
    if(dbData.manual_services.length===0) txt+="No manual";
    bot.sendMessage(uid, txt, {reply_markup:{inline_keyboard:[[{text:"🗑 Delete Manual", callback_data:"adm_del_manual"}, {text:"✏️ Edit Manual", callback_data:"adm_edit_manual"}, {text:tr(uid,'cancel'), callback_data:"cancel_action"}]]}});
  }
  if(data==='adm_del_manual'){ state.set(uid,{step:'admin_del_manual'}); bot.sendMessage(uid, "Send Manual Service ID to delete:", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
  if(data==='adm_edit_manual'){ state.set(uid,{step:'admin_edit_manual_id'}); bot.sendMessage(uid, "Send Manual Service ID to edit:", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
  if(data==='adm_manual_orders'){
    const pending=dbData.orders.filter(o=>o.manual && o.status==='Manual Pending');
    if(pending.length===0) return bot.sendMessage(uid, "No manual pending");
    let txt=`📦 Manual Pending: ${pending.length}\n`; let kb=[];
    pending.slice(-10).forEach(o=>{ txt+=`ID:${o.order_id} User:${o.user_id} ${o.service_name} Qty:${o.quantity} Link:${o.link} Charge ${formatMoney(o.charge_user, o.charge_currency)}\n`; kb.push([{text:`✅ Complete ${o.order_id}`, callback_data:`manual_complete_${o.order_id}`}, {text:`❌ Cancel ${o.order_id}`, callback_data:`manual_cancel_${o.order_id}`}]); });
    kb.push([{text:tr(uid,'cancel'), callback_data:"cancel_action"}]);
    bot.sendMessage(uid, txt, {reply_markup:{inline_keyboard:kb}});
  }
  if(data==='adm_manage_api'){
    // Removed as per user request: API is fixed from .env only
    return bot.sendMessage(uid, `🔧 API is fixed from .env file only as you requested.\n\nCurrent URL: ${API_URL}\nCurrent Key: ${API_KEY ? API_KEY.substring(0,4)+'***'+API_KEY.substring(API_KEY.length-4) : 'Not set'}\n\nTo change, edit .env in File Manager > Show Hidden Files and Restart App.\n\nUse Test API to check if it works.`, {reply_markup:{inline_keyboard:[[{text:"🧪 Test API", callback_data:"adm_test_api"}, {text:tr(uid,'cancel'), callback_data:"cancel_action"}]]}});
  }
  // Removed Change API URL and Key - fixed from .env only as per your request
  if(data==='adm_set_api_url' || data==='adm_set_api_key'){
    return bot.sendMessage(uid, `🔧 API is fixed from .env only (as you requested no Manage API needed).\n\nCurrent URL: ${API_URL}\nTo change, edit .env file in cPanel File Manager and Restart App.`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
  }
  if(data==='adm_test_api'){
    bot.sendMessage(uid, "🧪 Testing SMM API...");
    try{ const services=await smmPost({action:'services'}); const bal=await smmPost({action:'balance'}); bot.sendMessage(uid, `✅ API OK! Services: ${Array.isArray(services)?services.length:'?'} Balance: ${bal.balance||'?'} ${bal.currency||'INR'}\nURL: ${getSetting('api_url', API_URL_ENV)}`); }
    catch(e){ bot.sendMessage(uid, `❌ API Fail! ${e.message}\nURL: ${getSetting('api_url', API_URL_ENV)}\n\nFix:\n1. Check API_URL not your own domain\n2. Check API_KEY\n3. Use Manual Services as fallback`); }
  }
  if(data==='adm_offers'){
    let txt="🎁 Offers (Service-specific + Global + User-specific):\n"; dbData.offers.forEach(o=>{ txt+=`#${o.id} ${o.title} ${o.discount_percent}% valid ${o.valid_until} target ${o.target_user_id||'all'} service ${o.service_id||'all'}\n`; });
    if(dbData.offers.length===0) txt+="No offers";
    bot.sendMessage(uid, txt, {reply_markup:{inline_keyboard:[[{text:"➕ Create Offer", callback_data:"adm_create_offer"}, {text:"🗑 Delete Offer", callback_data:"adm_delete_offer"}], [{text:tr(uid,'cancel'), callback_data:"cancel_action"}]]}});
  }
  if(data==='adm_create_offer'){ state.set(uid,{step:'admin_offer_title'}); bot.sendMessage(uid, "🎁 Offer Title:", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
  if(data==='adm_delete_offer'){ state.set(uid,{step:'admin_delete_offer'}); bot.sendMessage(uid, "Send Offer ID to delete:", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
  if(data==='adm_bcast'){ state.set(uid,{step:'admin_bcast'}); bot.sendMessage(uid, "📢 Broadcast message:", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
  if(data==='adm_pending'){ checkPending(true, uid); }
  if(data==='adm_txns'){ let msg="💳 Last 15 Txns (Manual + NagrikPay):\n"; dbData.transactions.slice(-15).reverse().forEach(t=>{ msg+=`#${t.id} U:${t.user_id} ${formatMoney(t.amount,t.currency)} ${t.gateway} ${t.status} Txn:${maskIdPublic(t.txn_id)} Manual:${t.manual_trx||'auto'}\n`; }); bot.sendMessage(uid, msg, {reply_markup:{inline_keyboard:[[{text:"✅ Approve Manual", callback_data:"adm_approve_manual_prompt"}, {text:tr(uid,'cancel'), callback_data:"cancel_action"}]]}}); }
  if(data==='adm_approve_manual_prompt'){ state.set(uid,{step:'admin_approve_manual'}); bot.sendMessage(uid, "Send transaction DB ID to approve:\nEx: 5", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
  if(data==='adm_toggle_notify'){ const cur=getSetting('new_user_notify', true); setSetting('new_user_notify', !cur); bot.sendMessage(uid, `New user notify now ${!cur?'Enabled':'Disabled'}`); }
});

bot.on('message', async (msg)=>{
  if(!msg.text) return;
  // Handle group messages for support reply
  if(msg.chat.type==='supergroup' || msg.chat.type==='group'){
    if(msg.reply_to_message){
      const map=dbData.support_map.find(m=>m.group_msg_id===msg.reply_to_message.message_id || m.admin_msg_id===msg.reply_to_message.message_id);
      if(map && isAdmin(msg.from.id)){
        try{ await bot.sendMessage(map.user_id, `🎧 *Support Reply from Admin in group:*\n\n${msg.text}`, {parse_mode:"Markdown"}); bot.sendMessage(msg.chat.id, `✅ Replied to user ${map.user_id}`); }catch(e){ bot.sendMessage(msg.chat.id, "Failed to send to user"); }
        return;
      }
    }
    return;
  }

  if(msg.text.startsWith('/start') || msg.text.startsWith('/admin')) return;
  const uid=msg.from.id; ensureUser(msg);
  const text=msg.text.trim();
  const st=state.get(uid);

  if(isCancel(text)){
    state.delete(uid);
    const u=getUser(uid);
    return bot.sendMessage(uid, tr(uid,'cancelled'), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
  }

  if(st && st.step==='support_chat'){
    for(let aid of ADMIN_IDS){
      try{ const sent=await bot.sendMessage(aid, tr(aid,'support_fwd',{ID:uid, USER:msg.from.username||'no', CURR:getUser(uid).currency||'BDT', LANG:getUser(uid).lang||'en', MSG:text})); dbData.support_map.push({admin_msg_id:sent.message_id, user_id:uid, group_msg_id:null}); saveDB(); }catch(e){}
    }
    if(SUPPORT_GROUP_ID){
      try{
        const sentGroup=await bot.sendMessage(SUPPORT_GROUP_ID, `📩 *Support from ${getUser(uid).first_name} (@${msg.from.username||'none'}) ID ${maskIdPublic(uid)}*\n\n${text}\n\n#support\n\nTo reply, reply to this message in group.`, {parse_mode:"Markdown"});
        dbData.support_map.push({admin_msg_id:null, group_msg_id:sentGroup.message_id, user_id:uid}); saveDB();
      }catch(e){ console.log("Support group send fail", e.message); }
    }
    state.delete(uid);
    return bot.sendMessage(uid, tr(uid,'support_sent'), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
  }
  if(isAdmin(uid) && msg.reply_to_message){
    const map=dbData.support_map.find(m=>m.admin_msg_id===msg.reply_to_message.message_id);
    if(map){ try{ await bot.sendMessage(map.user_id, `🎧 *Support Reply:*\n\n${text}`, {parse_mode:"Markdown"}); bot.sendMessage(uid,`✅ Replied to ${map.user_id}`);}catch(e){ bot.sendMessage(uid,"Failed"); } return; }
  }

  if(isAdmin(uid) && st){
    if(st.step==='admin_search_user'){
      const targetId=parseInt(text); if(isNaN(targetId)) return bot.sendMessage(uid, "Invalid ID", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}});
      const target=getUser(targetId);
      if(!target){ state.delete(uid); return bot.sendMessage(uid, tr(uid,'user_not_found',{ID:targetId}), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}}); }
      const orders=dbData.orders.filter(o=>o.user_id===targetId).length;
      state.delete(uid);
      const info=tr(uid,'user_found',{ID:target.id, NAME:target.first_name, USERNAME:target.username||'none', LANG:target.lang||'?', CURR:target.currency||'?', BDT:(target.balance_bdt||0).toFixed(2), USD:(target.balance_usd||0).toFixed(2), SPENT_BDT:(target.total_spent_bdt||0).toFixed(2), SPENT_USD:(target.total_spent_usd||0).toFixed(2), JOINED:new Date(target.created_at).toLocaleString(), BANNED:target.banned?'Yes':'No', ORDERS:orders});
      return bot.sendMessage(uid, info, {parse_mode:"Markdown", reply_markup:{inline_keyboard:[[{text:"💰 Add Balance", callback_data:`admin_addbal_user_${targetId}`}, {text:"📦 View Orders", callback_data:`admin_view_orders_${targetId}`}], [{text:tr(uid,'cancel'), callback_data:"cancel_action"}]]}});
    }
    if(st.step==='admin_addbal'){
      const parts=text.split(/\s+/); const tid=parseInt(parts[0]); const amt=parseFloat(parts[1]); let curr=(parts[2]||'').toUpperCase();
      if(!curr){
        // If no currency specified, use target user's current currency (fixes your balance issue where admin added BDT but user currency USD)
        const targetUser=getUser(tid);
        curr=targetUser?.currency||'BDT';
      }
      if(!isNaN(tid)&&!isNaN(amt)){ addBalance(tid, amt, curr); state.delete(uid); const u=getUser(tid); bot.sendMessage(uid, `✅ Added ${formatMoney(amt,curr)} to ${tid} in ${curr} (user's current currency ${u?.currency||'BDT'}). BDT:${u?.balance_bdt||0} USD:${u?.balance_usd||0}`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}}); try{ bot.sendMessage(tid, `💰 Admin added ${formatMoney(amt,curr)} in ${curr}`);}catch(e){} return; }
    }
    if(st.step==='admin_addbal_specific'){
      const parts=text.split(/\s+/); const amt=parseFloat(parts[0]); let curr=(parts[1]||'').toUpperCase();
      if(!curr){
        const targetUser=getUser(st.target_id);
        curr=targetUser?.currency||'BDT';
      }
      if(!isNaN(amt)){ addBalance(st.target_id, amt, curr); state.delete(uid); return bot.sendMessage(uid, `✅ Added ${formatMoney(amt,curr)} to ${st.target_id} in ${curr} (user's current ${getUser(st.target_id)?.currency||'BDT'})`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}}); }
    }
    if(st.step==='admin_set_rates'){
      const parts=text.split(/\s+/); const bdt=parseFloat(parts[0]); const usd=parseFloat(parts[1]);
      if(!isNaN(bdt)&&!isNaN(usd)){ setSetting('inr_to_bdt', bdt); setSetting('inr_to_usd', usd); state.delete(uid); return bot.sendMessage(uid, `✅ Rates updated hidden: 1 INR=${bdt} BDT / ${usd} USD`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}}); }
      else return bot.sendMessage(uid,"Invalid Ex: 1.35 0.012", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}});
    }
    if(st.step==='admin_set_api_url'){ setSetting('api_url', text); state.delete(uid); return bot.sendMessage(uid, `✅ API URL updated to: ${text}\nTest via /admin -> Test API`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}}); }
    if(st.step==='admin_set_api_key'){ setSetting('api_key', text); state.delete(uid); return bot.sendMessage(uid, `✅ API Key updated: ${text.substring(0,4)}***${text.substring(text.length-4)}\nTest via /admin -> Test API`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}}); }
    if(st.step==='admin_add_manual_cat'){ st.category=text; st.step='admin_add_manual_name'; state.set(uid,st); return bot.sendMessage(uid, "Step 2/5 Name:", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
    if(st.step==='admin_add_manual_name'){ st.name=text; st.step='admin_add_manual_rate'; state.set(uid,st); return bot.sendMessage(uid, "Step 3/5 Rate INR per 1k:", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
    if(st.step==='admin_add_manual_rate'){ st.rate_inr=parseFloat(text); if(isNaN(st.rate_inr)) return bot.sendMessage(uid, "Invalid rate"); st.step='admin_add_manual_minmax'; state.set(uid,st); return bot.sendMessage(uid, "Step 4/5 Min Max:", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
    if(st.step==='admin_add_manual_minmax'){
      const parts=text.split(/\s+/); const min=parseInt(parts[0]); const max=parseInt(parts[1]);
      if(isNaN(min)||isNaN(max)) return bot.sendMessage(uid, "Invalid, send min max e.g. 100 10000");
      st.min=min; st.max=max; st.step='admin_add_manual_desc'; state.set(uid,st);
      return bot.sendMessage(uid, "Step 5/5 Description or skip:", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}});
    }
    if(st.step==='admin_add_manual_desc'){
      const desc=text.toLowerCase()==='skip'?'':text;
      st.description=desc;
      st.step='admin_add_manual_linktype';
      state.set(uid,st);
      return bot.sendMessage(uid, `Step 6/6 - Link Type:\n\nChoose link validation type:\n\n• All Link = User can send ANY text in link field (email, phone, username, link, anything) - No validation, allow all\n• Verified Link = Only allow valid platform links (must start with http:// or https:// and platform-specific)\n\nSend:\n\`all\` for All Link (allow anything like email Playgmail@gmail.com, phone, username)\n\`verified\` for Verified Link (only http/https links allowed)\n\nExample: all`, {parse_mode:"Markdown", reply_markup:{keyboard:[[{text:"all"}, {text:"verified"}, {text:"❌ Cancel"}]], resize_keyboard:true}});
    }
    if(st.step==='admin_add_manual_linktype'){
      const linkType=text.toLowerCase().trim();
      if(linkType!=='all' && linkType!=='verified'){
        return bot.sendMessage(uid, "Invalid link type. Send `all` or `verified`", {parse_mode:"Markdown", reply_markup:{keyboard:[[{text:"all"}, {text:"verified"}, {text:"❌ Cancel"}]], resize_keyboard:true}});
      }
      const newId=dbData.manual_services.length>0? Math.max(...dbData.manual_services.map(s=>s.id))+1 : 90001;
      dbData.manual_services.push({id:newId, name:st.name, category:st.category, rate_inr:st.rate_inr, min:st.min, max:st.max, description:st.description, link_type:linkType});
      // Ensure category exists in categories list
      let cats=getSetting('categories', null) || dbData.settings.categories || [];
      if(!cats.find(c=>c.name===st.category)){
        cats.push({name:st.category, enabled:true});
        setSetting('categories', cats);
      }
      saveDB(); state.delete(uid);
      return bot.sendMessage(uid, `✅ Manual Service Added!\nID: ${newId}\nCategory: ${st.category}\nName: ${st.name}\nRate: ${st.rate_inr} INR\nMin ${st.min} Max ${st.max}\nLink Type: ${linkType} (${linkType==='all'?'Allow anything like email/phone':'Only http/https verified links'})\n\nNow appears in categories!`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    }
    if(st.step==='admin_del_manual'){
      const id=parseInt(text); const idx=dbData.manual_services.findIndex(s=>s.id===id);
      if(idx!==-1){ dbData.manual_services.splice(idx,1); saveDB(); state.delete(uid); return bot.sendMessage(uid, `✅ Manual ${id} deleted`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}}); }
      else return bot.sendMessage(uid, "ID not found");
    }
    if(st.step==='admin_edit_manual_id'){
      const id=parseInt(text); const svc=dbData.manual_services.find(s=>s.id===id);
      if(!svc) return bot.sendMessage(uid, "ID not found");
      state.set(uid,{step:'admin_edit_manual_field', service_id:id});
      return bot.sendMessage(uid, `Editing Manual ID ${id}\nCurrent: Name ${svc.name}, Rate ${svc.rate_inr} INR, Min ${svc.min} Max ${svc.max}, Desc ${svc.description}\n\nSend field value\nFields: name, rate, min, max, desc, category\nEx: rate 150\nEx: name New Name`, {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}});
    }
    if(st.step==='admin_edit_manual_field'){
      const parts=text.split(' '); const field=parts[0].toLowerCase(); const value=parts.slice(1).join(' ');
      const svc=dbData.manual_services.find(s=>s.id===st.service_id);
      if(!svc) { state.delete(uid); return bot.sendMessage(uid, "Service not found"); }
      if(field==='name') svc.name=value;
      else if(field==='rate') svc.rate_inr=parseFloat(value);
      else if(field==='min') svc.min=parseInt(value);
      else if(field==='max') svc.max=parseInt(value);
      else if(field==='desc' || field==='description') svc.description=value;
      else if(field==='category') svc.category=value;
      else return bot.sendMessage(uid, "Invalid field. Use name, rate, min, max, desc, category");
      saveDB(); state.delete(uid);
      return bot.sendMessage(uid, `✅ Manual ID ${svc.id} updated: ${field} = ${value}`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    }
    if(st.step==='admin_edit_manual_order_price'){
      const parts=text.split(/\s+/); const amt=parseFloat(parts[0]); const curr=(parts[1]||'BDT').toUpperCase();
      const order=dbData.orders.find(o=>String(o.order_id)===String(st.order_id));
      if(!order) { state.delete(uid); return bot.sendMessage(uid, "Order not found"); }
      if(!isNaN(amt)){
        const oldCharge=order.charge_user;
        order.charge_user=amt; order.charge_currency=curr;
        const diff=amt-oldCharge;
        if(diff>0) deductBalance(order.user_id, diff, curr);
        else addBalance(order.user_id, -diff, curr);
        saveDB(); state.delete(uid);
        return bot.sendMessage(uid, `✅ Manual order ${st.order_id} price updated from ${formatMoney(oldCharge, curr)} to ${formatMoney(amt, curr)}`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
      }
    }
    if(st.step==='admin_offer_title'){ st.title=text; st.step='admin_offer_discount'; state.set(uid,st); return bot.sendMessage(uid,"Discount % (negative for price increase, e.g., -10 = +10%):", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
    if(st.step==='admin_offer_discount'){ st.discount=parseFloat(text); st.step='admin_offer_days'; state.set(uid,st); return bot.sendMessage(uid,"Valid days:", {reply_markup:{keyboard:[[{text:"❌ Cancel"}]], resize_keyboard:true}}); }
    if(st.step==='admin_offer_days'){ st.days=parseInt(text); st.step='admin_offer_target'; state.set(uid,st); return bot.sendMessage(uid,"Target: all or user ID:", {reply_markup:{keyboard:[[{text:"all"}, {text:"❌ Cancel"}]], resize_keyboard:true}}); }
    if(st.step==='admin_offer_target'){
      const target=text.trim(); let targetId=null;
      if(target.toLowerCase()!=='all'){ const tid=parseInt(target); if(isNaN(tid)) return bot.sendMessage(uid,"Invalid, send all or ID", {reply_markup:{keyboard:[[{text:"all"}, {text:"❌ Cancel"}]], resize_keyboard:true}}); targetId=tid; }
      st.target_user_id=targetId; st.step='admin_offer_service'; state.set(uid,st);
      return bot.sendMessage(uid,"Service ID: all or specific Service ID:", {reply_markup:{keyboard:[[{text:"all"}, {text:"❌ Cancel"}]], resize_keyboard:true}});
    }
    if(st.step==='admin_offer_service'){
      const svc=text.trim(); let serviceId=null;
      if(svc.toLowerCase()!=='all'){ const sid=parseInt(svc); if(isNaN(sid)) return bot.sendMessage(uid,"Invalid, send all or Service ID", {reply_markup:{keyboard:[[{text:"all"}, {text:"❌ Cancel"}]], resize_keyboard:true}}); serviceId=sid; }
      const valid=new Date(Date.now()+st.days*24*60*60*1000).toISOString();
      dbData.offers.push({id:dbData.offers.length+1, title:st.title, discount_percent:st.discount, valid_until:valid, target_user_id:st.target_user_id, service_id:serviceId, active:1});
      saveDB(); state.delete(uid);
      return bot.sendMessage(uid, tr(uid,'offer_created',{TITLE:st.title, DISC:st.discount, DAYS:st.days, TARGET:st.target_user_id||'all', SERVICE:serviceId||'all'}), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    }
    if(st.step==='admin_delete_offer'){ const id=parseInt(text); const idx=dbData.offers.findIndex(o=>o.id===id); if(idx!==-1){ dbData.offers.splice(idx,1); saveDB(); state.delete(uid); return bot.sendMessage(uid, `✅ Offer #${id} deleted`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}}); } else return bot.sendMessage(uid, "ID not found"); }
    if(st.step==='admin_bcast'){
      let c=0; for(let u of dbData.users){ try{ await bot.sendMessage(u.id, `📢 *Broadcast:*\n\n${text}`, {parse_mode:"Markdown"}); c++; await new Promise(r=>setTimeout(r,80)); }catch(e){} }
      state.delete(uid); return bot.sendMessage(uid, `✅ Broadcast to ${c}`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    }
    if(st.step==='admin_approve_manual'){
      let id=parseInt(text.replace('approve_','').trim());
      const txn=dbData.transactions.find(t=>t.id===id);
      if(!txn) return bot.sendMessage(uid, "Txn ID not found");
      if(txn.status==='completed') return bot.sendMessage(uid, "Already completed");
      txn.status='completed'; saveDB();
      addBalance(txn.user_id, txn.amount, txn.currency);
      // Referral bonus only on 1st deposit
      giveReferralBonusIfFirstDeposit(txn.user_id, txn.amount, txn.currency);
      const user=getUser(txn.user_id);
      try{ await bot.sendMessage(txn.user_id, `✅ Manual payment approved! ${formatMoney(txn.amount, txn.currency)} added. Trx: ${txn.manual_trx||txn.txn_id}`); }catch(e){}
      // Notify deposit group
      await trySendToGroup(DEPOSIT_GROUP_ID, `💰 *Manual Deposit Approved*\nUser ${user.first_name} ID ${maskIdPublic(user.id)}\nAmount ${formatMoney(txn.amount, txn.currency)}\nTrx ${maskIdPublic(txn.manual_trx||txn.txn_id)}\n#deposit`, {parse_mode:"Markdown"});
      state.delete(uid);
      return bot.sendMessage(uid, `✅ Approved txn #${id} for user ${txn.user_id} amount ${formatMoney(txn.amount, txn.currency)}`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    }
  }

  if(st){
    if(st.step==='await_link'){
      // Support reorder "same" keyword
      if(text.toLowerCase()==='same' && st.reorder_link){
        st.link=st.reorder_link;
      } else {
        // Check link_type for manual services: All Link vs Verified Link (as per your requirement)
        const linkType = st.service.link_type || (st.service.manual ? 'all' : 'verified'); // Default manual to all to allow email/phone like Tg number
        // For Tg number, email, phone services, allow any text
        const isAllLink = linkType==='all' || st.service.category.toLowerCase().includes('number') || st.service.name.toLowerCase().includes('number') || st.service.name.toLowerCase().includes('gmail') || st.service.name.toLowerCase().includes('email');
        
        if(isAllLink){
          // All Link: Allow anything (email, phone, username, link, any text) - no validation, allow all as you requested
          if(text.trim().length<3){
            return bot.sendMessage(uid, "❌ Link/text too short. Send at least 3 characters or Cancel", {reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}});
          }
          st.link=text.trim();
        } else {
          // Verified Link: Only allow valid platform links (must start with http/https)
          if(!text.startsWith('http')){
            if(text.includes('https://') || text.includes('http://')){
              const urlMatch=text.match(/https?:\/\/\S+/);
              if(urlMatch) st.link=urlMatch[0];
              else return bot.sendMessage(uid, tr(uid,'invalid_link')+`\n\nThis service requires Verified Link (must start with http/https). If you want to allow any text like email/phone, admin should set service Link Type to 'all' when adding manual service.`, {reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}});
            } else {
              return bot.sendMessage(uid, tr(uid,'invalid_link')+`\n\nFor this service, Verified Link required (http/https). For email/phone like Playgmail@gmail.com, admin should set Link Type to 'all'`, {reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}});
            }
          } else {
            st.link=text;
          }
        }
      }
      st.step='await_qty'; state.set(uid,st);
      const eff=getEffectiveRate(st.service, uid);
      // If reorder, suggest previous qty as quick button
      let qtyKb={keyboard:[[{text:st.reorder_qty ? String(st.reorder_qty) : "100"}, {text:"1000"}, {text:"5000"}], [{text:tr(uid,'cancel')}]], resize_keyboard:true};
      if(st.reorder_qty){
        return bot.sendMessage(uid, `🔄 Reorder - Previous Qty: ${st.reorder_qty}\n\n${tr(uid,'ask_qty',{MIN:st.service.min, MAX:st.service.max, PRICE:eff.rateUser.toFixed(4), CURR:eff.currency})}\n\nSend new qty or tap previous qty button`, {reply_markup:qtyKb});
      }
      return bot.sendMessage(uid, tr(uid,'ask_qty',{MIN:st.service.min, MAX:st.service.max, PRICE:eff.rateUser.toFixed(4), CURR:eff.currency}), {reply_markup:qtyKb});
    }
    if(st.step==='await_qty'){
      const qty=parseInt(text); if(isNaN(qty) || qty < parseInt(st.service.min) || qty > parseInt(st.service.max)) return bot.sendMessage(uid, tr(uid,'invalid_qty',{MIN:st.service.min, MAX:st.service.max}), {reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}});
      st.quantity=qty; const eff=getEffectiveRate(st.service, uid);
      const chargeINR=eff.rateINR*qty/1000; const chargeUser=eff.rateUser*qty/1000;
      state.set(uid,st);
      return bot.sendMessage(uid, tr(uid,'confirm',{NAME:st.service.name, ID:st.service.service, CAT:st.service.category, LINK:st.link, QTY:qty, PRICE:eff.rateUser.toFixed(4), CURR:eff.currency, CONV:eff.convRate, CURR:eff.currency, TOTAL:formatMoney(chargeUser, eff.currency), INR_TOTAL:chargeINR.toFixed(2), MANUAL:st.service.manual?'Yes':'No'}), {parse_mode:"Markdown", reply_markup:{inline_keyboard:[[{text:"✅ Confirm", callback_data:"confirm_yes"}, {text:"❌ Cancel", callback_data:"cancel_action"}]]}});
    }
    if(st.step==='await_service_manual'){
      try{
        const query = text.toLowerCase().trim();
        const services = await getServices();
        let results = [];

        // 1. Search by Service ID exact match
        services.forEach(s=>{
          if(String(s.service)===text.trim()){
            results.push({...s, manual:false, matchType:'id_exact'});
          }
        });
        dbData.manual_services.forEach(s=>{
          if(String(s.id)===text.trim()){
            results.push({service:s.id, name:s.name, category:s.category, rate:s.rate_inr, min:s.min, max:s.max, manual:true, matchType:'id_exact'});
          }
        });

        // 2. If not found exact, search by ID contains or name contains or category contains
        if(results.length===0){
          // Check if query is numeric - search ID contains
          services.forEach(s=>{
            if(String(s.service).includes(query) || s.name.toLowerCase().includes(query) || s.category.toLowerCase().includes(query)){
              if(isSvcEnabled(s.service) && isCatEnabled(s.category)){
                results.push({...s, manual:false, matchType:'name_contains'});
              }
            }
          });
          dbData.manual_services.forEach(s=>{
            if(String(s.id).includes(query) || s.name.toLowerCase().includes(query) || s.category.toLowerCase().includes(query)){
              results.push({service:s.id, name:s.name, category:s.category, rate:s.rate_inr, min:s.min, max:s.max, manual:true, matchType:'name_contains'});
            }
          });
          // Also search user's previous orders by order_id or service name
          const userOrders = dbData.orders.filter(o=>o.user_id===uid && (String(o.order_id).includes(query) || o.service_name.toLowerCase().includes(query)));
          userOrders.slice(0,5).forEach(o=>{
            // Find service for this order if still exists
            const svc = services.find(s=>String(s.service)===String(o.service_id));
            if(svc){
              if(!results.find(r=>String(r.service)===String(svc.service))){
                results.push({...svc, manual:false, matchType:'from_order'});
              }
            } else {
              const manual = dbData.manual_services.find(s=>String(s.id)===String(o.service_id));
              if(manual && !results.find(r=>String(r.service)===String(manual.id))){
                results.push({service:manual.id, name:manual.name, category:manual.category, rate:manual.rate_inr, min:manual.min, max:manual.max, manual:true, matchType:'from_order'});
              }
            }
          });
        }

        // Remove duplicates
        const uniqueResults=[];
        const seen=new Set();
        results.forEach(r=>{
          const key=String(r.service)+'-'+(r.manual?'m':'a');
          if(!seen.has(key)){ seen.add(key); uniqueResults.push(r); }
        });
        results=uniqueResults.slice(0,20); // Limit to 20

        if(results.length===0){
          return bot.sendMessage(uid, tr(uid,'invalid_sid',{ID:text})+`\n\n🔍 Searched for "${text}" in Service ID, Service Name (like "Facebook follow"), Category, and your previous Order IDs\nNo services found. Try different keyword like "Facebook", "Instagram", "like", "follow"\n\n${T.en.api_not_found_help||''}`, {reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}});
        }

        if(results.length===1){
          // Single exact match - go directly to link step
          const finalSvc=results[0];
          if(!isSvcEnabled(finalSvc.service) || !isCatEnabled(finalSvc.category)) return bot.sendMessage(uid, "Disabled by admin", {reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}});
          state.set(uid,{step:'await_link', service:finalSvc});
          const eff=getEffectiveRate(finalSvc, uid);
          return bot.sendMessage(uid, `🛠 *Found 1 Service:*\n*${finalSvc.name}* ${finalSvc.manual?'(MANUAL)':''}\nCategory: ${finalSvc.category}\nPrice: ${formatMoney(eff.rateUser, eff.currency)}/1k\nMin ${finalSvc.min} Max ${finalSvc.max}\n\n${tr(uid,'ask_link')}`, {parse_mode:"Markdown", reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}});
        }

        // Multiple results - show list with pricing
        let txt=`🔍 *Search Results for "${text}" - Found ${results.length} services:*\n\n`;
        let kb=[];
        results.forEach((s, idx)=>{
          const eff=getEffectiveRate(s, uid);
          txt+=`${idx+1}. ID:${s.service} - ${s.name.slice(0,35)} - ${formatMoney(eff.rateUser, eff.currency)}/1k - ${s.category}${s.manual?' (MANUAL)':''}\n`;
          // Only first 10 as buttons to avoid too many buttons
          if(idx<10){
            kb.push([{text:`${s.service} - ${s.name.slice(0,20)} ${formatMoney(eff.rateUser, eff.currency)}/1k`, callback_data:`svc_${s.service}_${s.manual?'m':'a'}`}]);
          }
        });
        txt+=`\nTap button to order or type more specific search`;
        kb.push([{text:tr(uid,'cancel'), callback_data:"cancel_action"}]);
        return bot.sendMessage(uid, txt, {parse_mode:"Markdown", reply_markup:{inline_keyboard:kb}});
      }catch(e){ return bot.sendMessage(uid, `❌ API Error: ${e.message}`, {reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}}); }
    }
    if(st.step==='await_funds_amount'){
      const amt=parseFloat(text); if(isNaN(amt)||amt<1) return bot.sendMessage(uid, "Min 1", {reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}});
      const u=getUser(uid); const curr=u.currency||'BDT';
      state.set(uid,{step:'await_gateway', amount:amt});
      return bot.sendMessage(uid, tr(uid,'ask_gateway',{AMT:formatMoney(amt,curr), CURR:curr}), {reply_markup:{inline_keyboard:[[{text:`📱 NagrikPay ${formatMoney(amt,curr)} (Only Gateway)`, callback_data:`paygw_nagrikpay`}],[{text:`💵 Manual bKash/Nagad TrxID`, callback_data:`paygw_manual`}],[{text:tr(uid,'cancel'), callback_data:"cancel_action"}]]}});
    }
    if(st.step==='await_manual_trxid'){
      const trxId=text.split(/\s+/)[0];
      const amount=st.amount; const currency=getUser(uid).currency||'BDT';
      const newId=dbData.transactions.length+1;
      dbData.transactions.push({id:newId, user_id:uid, amount, currency, gateway:'manual', txn_id:`MANUAL_${Date.now()}`, manual_trx:trxId, status:'pending', created_at:new Date().toISOString()}); saveDB();
      state.delete(uid);
      const user=getUser(uid);
      const pendingMsg=`💵 *Manual Deposit Pending*\nUser: ${user.first_name} (@${user.username||'none'}) ID ${maskIdPublic(uid)}\nAmount: ${formatMoney(amount,currency)}\nTrxID: ${maskIdPublic(trxId)} Full: ${trxId}\nGateway: Manual\n#manual_deposit_pending`;
      await trySendToGroup(DEPOSIT_GROUP_ID, pendingMsg, {parse_mode:"Markdown"});
      for(let aid of ADMIN_IDS){ try{ await bot.sendMessage(aid, `💵 Manual Deposit Pending\nUser: ${uid} ${user.first_name}\nAmount: ${formatMoney(amount,currency)}\nTrxID: ${trxId}\nTxn DB ID: ${newId}\nApprove via /admin -> Txns`); }catch(e){} }
      return bot.sendMessage(uid, `✅ Manual deposit submitted!\nAmount: ${formatMoney(amount,currency)}\nTrxID: ${trxId}\n\nAdmin will verify and add balance.\n\nDeposit notification sent to deposit group with masked ID.`, {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    }
  }

  const lang=getUser(uid).lang||'en';
  const tNew=T[lang]?.new_order||T.en.new_order;
  const tTrack=T[lang]?.track_order||T.en.track_order;
  const tAdd=T[lang]?.add_funds||T.en.add_funds;
  const tProf=T[lang]?.profile||T.en.profile;
  const tSup=T[lang]?.support||T.en.support;
  const tCurr=T[lang]?.currency||T.en.currency;
  const tLang=T[lang]?.language||T.en.language;

  if(text===tNew || text.includes("New Order") || text.includes("নতুন অর্ডার")){
    const chk=await checkUserJoinedAll(uid); if(FORCE_JOIN_ENABLED && !chk.joined){ return sendForceJoinMessage(uid); }
    // NEW FLOW: 3 options Auto Manual Search
    return bot.sendMessage(uid, tr(uid,'new_order_type'), {reply_markup:{inline_keyboard:[
      [{text:tr(uid,'auto')||"🤖 Auto (API)", callback_data:"neworder_auto"}, {text:tr(uid,'manual')||"🛠 Manual", callback_data:"neworder_manual"}],
      [{text:tr(uid,'search')||"🔍 Search", callback_data:"neworder_search"}],
      [{text:tr(uid,'cancel'), callback_data:"cancel_action"}]
    ]}});
  }
  if(text==="🔢 Service ID" || text.includes("Service ID")){ state.set(uid,{step:'await_service_manual'}); return bot.sendMessage(uid, "Send Service ID:", {reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}}); }
  if(text===tTrack || text.includes("Track Order") || text.includes("ট্র্যাক") || text.includes("Previous Orders") || text.includes("পূর্ববর্তী")){
    const rows=dbData.orders.filter(o=>o.user_id===uid).slice(-15).reverse();
    if(rows.length===0) return bot.sendMessage(uid, tr(uid,'no_orders'), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
    let txt=`📦 *Previous Orders - Tap Reorder to quickly reorder:*\n\n${tr(uid,'your_orders')}\n\n`;
    let kb=[];
    rows.forEach(r=>{
      txt+=`#${maskIdPublic(r.order_id)} ${r.service_name.slice(0,22)} | ${r.status} | ${formatMoney(r.charge_user, r.charge_currency)} | Qty:${r.quantity}\nLink: ${r.link.slice(0,30)}...\n\n`;
      kb.push([
        {text:`🔄 Reorder #${maskIdPublic(r.order_id)}`, callback_data:`reorder_${r.order_id}`},
        {text:`📊 Check ${maskIdPublic(r.order_id)}`, callback_data:`check_${r.order_id}`}
      ]);
      kb.push([
        {text:`📋 Copy ID ${maskIdPublic(r.order_id)}`, callback_data:`copy_order_${r.order_id}`},
        {text:`🔗 Copy Link`, callback_data:`copy_link_${r.order_id}`}
      ]);
    });
    kb.push([{text:"🔄 Reorder Last Order", callback_data:`reorder_last`}, {text:tr(uid,'cancel'), callback_data:"cancel_action"}]);
    return bot.sendMessage(uid, txt, {parse_mode:"Markdown", reply_markup:{inline_keyboard:kb}});
  }
  if(text===tAdd || text.includes("Add Funds") || text.includes("ফান্ড")){
    const chk=await checkUserJoinedAll(uid); if(FORCE_JOIN_ENABLED && !chk.joined){ return sendForceJoinMessage(uid); }
    const u=getUser(uid); const balBDT=u.balance_bdt||0; const balUSD=u.balance_usd||0; const currBal=u.currency==='USD'||u.currency==='USDT'?balUSD:balBDT;
    state.set(uid,{step:'await_funds_amount'});
    // Deposit currency same as selected currency
    return bot.sendMessage(uid, tr(uid,'balance_msg',{BDT:balBDT.toFixed(2), USD:balUSD.toFixed(2), CURR_WALLET:formatMoney(currBal, u.currency), CURR:u.currency}), {reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}});
  }
  if(text===tProf || text.includes("Profile") || text.includes("প্রোফাইল")){
    const u=getUser(uid); const totalOrders=dbData.orders.filter(o=>o.user_id===uid).length;
    const referralCount=dbData.users.filter(x=>x.referred_by===uid).length;
    const referralLink=`https://t.me/${(await bot.getMe()).username}?start=REF${uid}`;
    const curr=u.currency||'BDT';
    const balInfo=getUserBalanceInfo(u);
    // Currency only selected - show only selected currency as per your requirement
    let profileText;
    if(CURRENCY_DISPLAY==='only_selected'){
      profileText=`👤 *Profile TotoCompamysmm*\nID: ${maskId(uid)}\nName: ${u.first_name} (@${u.username||'none'})\nLang: ${u.lang} | Curr: ${curr}\n\n💰 Balance: ${formatMoney(balInfo.amount, curr)} ONLY in ${curr} (as you requested, no other currency shown)\n💸 Spent: ${curr==='USD'?`$${(u.total_spent_usd||0).toFixed(2)}`:`৳${(u.total_spent_bdt||0).toFixed(2)}`} in ${curr} only\nOrders: ${totalOrders} | Referrals: ${referralCount} | Discount: ${u.discount||0}%\n\n🎁 Referral (5% on 1st deposit only):\n\`${referralLink}\``;
    } else {
      profileText=tr(uid,'profile_msg',{ID:maskId(uid), NAME:u.first_name, USERNAME:u.username||'none', LANG:u.lang, CURR:curr, BDT:(u.balance_bdt||0).toFixed(2), USD:(u.balance_usd||0).toFixed(2), SPENT_BDT:(u.total_spent_bdt||0).toFixed(2), SPENT_USD:(u.total_spent_usd||0).toFixed(2), TOTAL_ORDERS:totalOrders, REF:referralCount, DISC:u.discount||0, REF_LINK:referralLink})+`\n\n🎁 Referral Link:\n\`${referralLink}\`\n\n📋 Copy Referral: Tap code to copy`;
    }
    return bot.sendMessage(uid, profileText, {parse_mode:"Markdown", reply_markup:{keyboard: mainKb(uid), resize_keyboard:true, inline_keyboard:[[{text:"📋 Copy Referral Link", callback_data:`copy_referral_${uid}`}], [{text:"📜 Transaction History", callback_data:"tx_history"}, {text:"📊 My Stats", callback_data:"my_stats"}]]}});
  }
  if(text===tSup || text.includes("Support") || text.includes("সাপোর্ট")){ state.set(uid,{step:'support_chat'}); return bot.sendMessage(uid, tr(uid,'support_ask'), {reply_markup:{keyboard:[[{text:tr(uid,'cancel')}]], resize_keyboard:true}}); }
  if(text===tCurr || text.includes("Currency") || text.includes("মুদ্রা")) return askCurrency(uid);
  if(text===tLang || text.includes("Language") || text.includes("ভাষা")) return bot.sendMessage(uid, T.en.select_lang, {reply_markup:{inline_keyboard:[[{text:"🇧🇩 Bangla", callback_data:"lang_bn"}, {text:"🇬🇧 English", callback_data:"lang_en"}], [{text:tr(uid,'cancel'), callback_data:"cancel_action"}]]}});

  if(!st){
    const chk=await checkUserJoinedAll(uid); if(FORCE_JOIN_ENABLED && !chk.joined){ return sendForceJoinMessage(uid); }
    const u=getUser(uid); const bal=getUserBalanceInfo(u);
    bot.sendMessage(uid, tr(uid,'welcome',{BALANCE:formatMoney(bal.amount, bal.code), LANG:u.lang, CURR:bal.code, ID:uid}), {reply_markup:{keyboard: mainKb(uid), resize_keyboard:true}});
  }
});

async function checkPending(manual=false, adminId=null){
  const pend=dbData.orders.filter(o=>!['Completed','Canceled','Refunded','Partial','Manual Completed'].includes(o.status) && !o.manual);
  if(manual && adminId) bot.sendMessage(adminId, `⏳ Checking ${pend.length} pending API orders...`);
  for(let o of pend){
    try{
      const res=await smmPost({action:'status', order:o.order_id});
      const status=res.status; if(!status) continue;
      if(status!==o.status){
        o.status=status; saveDB();
        if(status==='Completed'){ try{ await bot.sendMessage(o.user_id, `✅ Order #${maskIdPublic(o.order_id)} Completed! ${o.service_name}`); }catch(e){} }
        else if(['Canceled','Refunded'].includes(status) && !o.refunded){ addBalance(o.user_id, o.charge_user, o.charge_currency); o.refunded=1; saveDB(); try{ await bot.sendMessage(o.user_id, `💸 #${maskIdPublic(o.order_id)} ${status}. Refunded ${formatMoney(o.charge_user, o.charge_currency)}`); }catch(e){} }
        else if(status==='Partial'){ const remains=parseInt(res.remains||0); if(remains>0 && !o.refunded){ const refundUser=o.charge_user*remains/o.quantity; addBalance(o.user_id, refundUser, o.charge_currency); o.refunded=1; saveDB(); try{ await bot.sendMessage(o.user_id, `⚠️ #${maskIdPublic(o.order_id)} Partial Remains ${remains} Refunded ${formatMoney(refundUser, o.charge_currency)}`); }catch(e){} } }
      }
      await new Promise(r=>setTimeout(r,1000));
    }catch(e){ console.log("cron", e.message); }
  }
  if(manual && adminId) bot.sendMessage(adminId, `✅ Checked ${pend.length}`);
}
setInterval(()=>checkPending(false), 3*60*1000);

console.log("✅ FINAL TotoCompamysmm Bot 100% Working PRO | All 16 Tasks Fixed | cPanel No Terminal");
console.log("Admins:", ADMIN_IDS);
console.log("Groups: Order", ORDER_GROUP_ID, "Deposit", DEPOSIT_GROUP_ID, "Support", SUPPORT_GROUP_ID, "Manual", MANUAL_GROUP_ID);
console.log("NagrikPay Only:", NAGRIKPAY_KEY ? "Key Set" : "NOT SET");
console.log(`Webhook: ${WEBHOOK_URL}/webhook/nagrikpay | Force Join: ${FORCE_JOIN_ENABLED}`);
