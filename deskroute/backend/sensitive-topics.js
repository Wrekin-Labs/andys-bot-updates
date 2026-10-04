// Deterministic floor for forced human handoff. It can only escalate.
export const SENSITIVE_TOPICS=Object.freeze({
  safeguarding:{priority:"urgent",notifyPreview:false,label:"Safeguarding"},
  legal:{priority:"high",notifyPreview:true,label:"Legal"},
  data_protection:{priority:"high",notifyPreview:true,label:"Data protection"},
  payment_dispute:{priority:"high",notifyPreview:true,label:"Payment dispute"},
  complaint:{priority:"high",notifyPreview:true,label:"Complaint"}
});

const RULES=[
  ["safeguarding",[
    /\bsafeguarding\b/i,
    /\b(?:in|at)\s+(?:immediate\s+)?danger\b/i,
    /\bnot\s+safe\s+(?:at\s+home|with\s+(?:him|her|them))\b/i,
    /\b(?:abused|abusive\s+(?:partner|relationship|parent)|domestic\s+(?:violence|abuse)|child\s+abuse|sexual\s+abuse)\b/i,
    /\b(?:self[\s-]?harm(?:ing)?|(?:harm|hurt|cut)(?:ing)?\s+(?:myself|themselves|himself|herself))\b/i,
    /\b(?:suicid(?:e|al)|kill(?:ing)?\s+myself|end(?:ing)?\s+(?:my\s+life|it\s+all)|want\s+to\s+die|don'?t\s+want\s+to\s+(?:live|be\s+here\s+anymore))\b/i,
    /\boverdos(?:e|ed|ing)\b/i,
    /\b(?:he|she|they)\s+(?:hits?|beats?|hurts?)\s+me\b/i
  ]],
  ["legal",[
    /\blegal\s+action\b/i,
    /\bletter\s+before\s+(?:action|claim)\b/i,
    /\bsmall\s+claims\b/i,
    /\b(?:take|taking|took)\s+(?:you|this|it|the\s+matter|them)\s+to\s+court\b/i,
    /\b(?:sue|suing)\s+(?:you|your|the\s+(?:company|business)|them)\b/i,
    /\b(?:my|our)\s+(?:solicitors?|lawyers?)\b/i,
    /\b(?:speak|speaking|talk|talking|contact|contacting|consult|consulting)\s+(?:to\s+|with\s+)?(?:a|my|our)\s+(?:solicitor|lawyer)s?\b/i,
    /\btrading\s+standards\b/i,
    /\bombudsman\b/i
  ]],
  ["data_protection",[
    /\bsubject\s+access\s+request\b/i,
    /\bDSAR\b/,
    /\bdata\s+protection\s+request\b/i,
    /\bright\s+to\s+(?:erasure|be\s+forgotten)\b/i,
    /\b(?:delete|erase|remove)\s+(?:all\s+)?(?:of\s+)?(?:my|our)\s+(?:personal\s+)?(?:data|information|details)\b/i,
    /\b(?:gdpr\s+request|under\s+(?:the\s+)?gdpr)\b/i,
    /\bwhat\s+(?:personal\s+)?(?:data|information)\s+(?:do\s+)?you\s+(?:hold|have|store|keep)\s+(?:on|about)\s+(?:me|us)\b/i,
    /\breport\s+(?:you|this)\s+to\s+the\s+ico\b/i
  ]],
  ["payment_dispute",[
    /\bchargeback\b/i,
    /\bdispute\s+(?:this|the|a)\s+(?:charge|payment|transaction)\b/i,
    /\b(?:charged|debited|billed)\s+(?:me\s+|us\s+)?(?:twice|double|incorrectly|wrongly|without)\b/i,
    /\b(?:unauthori[sz]ed|fraudulent)\s+(?:payment|charge|transaction)\b/i,
    /\b(?:i|we)\s+(?:want|need|demand|expect)\s+(?:a\s+(?:full\s+)?|my\s+|our\s+)?refund\b/i,
    /\bi'?d\s+like\s+(?:a|my)\s+refund\b/i,
    /\b(?:i|we)\s+(?:want|need|demand)\s+(?:my|our)\s+money\s+back\b/i
  ]],
  ["complaint",[
    /\bformal\s+complaint\b/i,
    /\b(?:make|making|raise|raising|file|lodge|submit)\s+(?:a\s+)?complaint\b/i,
    /\b(?:i|we)\s+(?:want|wish|would\s+like)\s+to\s+complain\b/i,
    /\bcomplain(?:ing)?\s+about\b/i,
    /\bcomplaints?\s+(?:procedure|process)\b/i
  ]]
];

function normalise(message){
  return String(message||"")
    .slice(0,4000)
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02BC]/g,"'")
    .replace(/\s+/g," ");
}

export function sensitiveTopic(message){
  const text=normalise(message);
  for(const [topic,patterns] of RULES){
    if(patterns.some(pattern=>pattern.test(text)))return topic;
  }
  return null;
}

export function sensitiveTopicFromTags(tags){
  const tag=(Array.isArray(tags)?tags:[])
    .find(value=>typeof value==="string"&&value.startsWith("sensitive-"));
  const topic=tag?tag.slice("sensitive-".length):null;
  return topic&&topic in SENSITIVE_TOPICS?topic:null;
}
