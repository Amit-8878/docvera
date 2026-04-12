const store = require("./reviewStore");

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function maskPhone() {
  const last4 = randomInt(1000, 9999);
  return "+91****" + last4;
}

const names = [
  "Rahul Sharma",
  "Amit Verma",
  "Sandeep Yadav",
  "Vikas Patel",
  "Rohit Singh",
  "Pooja Mishra",
  "Neha Gupta",
  "Arjun Mehta",
  "Kiran Joshi",
  "Deepak Rao",
  "Ankit Tiwari",
  "Priya Soni",
  "Manish Dubey",
  "Sunita Devi",
  "Rajesh Kumar",
];

const locations = [
  "Gwalior",
  "Indore",
  "Raipur",
  "Sabalgarh",
  "Bhopal",
  "Jabalpur",
  "Ujjain",
  "Sagar",
  "Ratlam",
  "Rewa",
  "Satna",
  "Morena",
];

function pickAmount() {
  const tier = Math.random();
  if (tier < 0.38) {
    return randomInt(500, 2000);
  }
  if (tier < 0.78) {
    return randomInt(2000, 10000);
  }
  return randomInt(10000, 50000);
}

function fmt(n) {
  return n.toLocaleString("en-IN");
}

const templates = [
  "Pehli baar ₹{amount} mila — bharosa badh gaya",
  "₹{amount} withdraw kiya, speed acchi lagi",
  "Regular earning ho rahi hai, roz thoda-thoda",
  "Is week ₹{amount} tak pohonch gaya",
  "₹{amount} bank me aa gaya notification ke sath",
  "Maja aa gaya! Is mahine ₹{amount} kamaya",
  "₹{amount} tak side income ho gayi",
  "₹{amount} ka target cross — withdrawal smooth",
  "Document 2 minute me mil gaya, tension khatam",
  "Pehle line me lagna padta tha, ab ghar se sab ho jata hai",
  "Service speed bahut acchi hai, time bachta hai",
  "Form fill karke relax — delivery jaldi",
  "App smooth chal rahi hai, UI simple hai",
  "Trustworthy lagta hai, payment clear hai",
  "Customer support ne jaldi help ki",
  "PDF clear mili, print karke kaam ho gaya",
  "Office jane ki zarurat nahi padi",
  "Small town se bhi easily use ho raha hai",
  "Verification fast thi, document genuine laga",
  "Withdrawal process simple tha, koi dikkat nahi",
  "Family ko recommend karunga, safe lagta hai",
  "Time saving app hai, worth it",
  "Ghar baithe kaam ho gaya, best experience",
  "Tracking update milta rahta hai, tension nahi",
  "Document quality achhi thi, office me chal gayi",
  "Ease of use top class, beginner friendly",
  "Payment gateway smooth, receipt mil gayi",
];

const negativeTemplates = [
  "Ek baar thoda delay hua, baaki theek hai",
  "Network issue ki wajah se retry karna pada",
  "Support thoda slow thi peak hours me",
];

function pickRating(isNegative) {
  if (isNegative) {
    return Math.random() < 0.6 ? 4 : 3;
  }
  return Math.random() < 0.12 ? 4 : 5;
}

async function generateReview() {
  const isNegative = Math.random() < 0.08;
  const amount = pickAmount();

  let text;
  if (isNegative) {
    text = random(negativeTemplates);
  } else {
    const tpl = random(templates);
    text = tpl.includes("{amount}") ? tpl.replace("{amount}", fmt(amount)) : tpl;
  }

  const row = {
    name: random(names),
    location: random(locations),
    phoneMasked: maskPhone(),
    text,
    rating: pickRating(isNegative),
    type: isNegative ? "negative" : "positive",
  };

  const saved = await store.addReview({ ...row, source: "ai", status: "approved" });
  return saved || row;
}

module.exports = { generateReview };
