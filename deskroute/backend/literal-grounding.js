const WEEKDAYS=[
  ["monday",["monday","mon"]],["tuesday",["tuesday","tue","tues"]],
  ["wednesday",["wednesday","wed"]],["thursday",["thursday","thu","thur","thurs"]],
  ["friday",["friday","fri"]],["saturday",["saturday","sat"]],["sunday",["sunday","sun"]]
];

function normaliseText(value){
  let text=String(value||"").toLowerCase()
    .replace(/[–—]/g,"-")
    .replace(/\s+/g," ")
    .trim();
  for(const [full,forms] of WEEKDAYS){
    for(const form of forms){
      text=text.replace(new RegExp("\\b"+form+"\\b","g"),full);
    }
  }
  return text;
}

function unique(values){
  return [...new Set(values.filter(Boolean))];
}

function extractedClaims(text){
  const raw=normaliseText(text);
  const values=[];

  for(const m of raw.matchAll(/(?:£|\$|€)\s?\d+(?:[.,]\d{1,2})?/g)){
    values.push(m[0].replace(/\s+/g,"").replace(",","."));
  }

  for(const m of raw.matchAll(/\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?(?:am|pm))?\b|\b(?:1[0-2]|0?[1-9])\s?(?:am|pm)\b/g)){
    values.push(m[0].replace(/\s+/g,""));
  }

  for(const [full] of WEEKDAYS){
    if(new RegExp("\\b"+full+"\\b").test(raw))values.push(full);
  }

  for(const m of raw.matchAll(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/g)){
    values.push(m[0].replace(/,/g,"").replace(/\b(st|nd|rd|th)\b/g,"").replace(/\s+/g," ").trim());
  }

  for(const m of raw.matchAll(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/g))values.push(m[0]);

  for(const m of raw.matchAll(/https?:\/\/[^\s<>"')]+/g))values.push(m[0].replace(/[.,;!?]+$/,""));

  for(const m of raw.matchAll(/(?:\+?44\s?(?:\(0\)\s?)?|0)(?:\d[\s-]?){9,10}\d/g)){
    values.push(m[0].replace(/[\s()-]/g,""));
  }

  return unique(values);
}

function evidenceContains(claim,evidenceText){
  const evidence=normaliseText(evidenceText);
  if(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(claim)){
    return new RegExp("\\b"+claim+"\\b").test(evidence);
  }
  if(/^(?:£|\$|€)/.test(claim)){
    return evidence.replace(/\s+/g,"").replace(/,/g,".").includes(claim);
  }
  if(/^(?:\d{1,2}:\d{2}|\d{1,2})(?:am|pm)?$/.test(claim)){
    return evidence.replace(/\s+/g,"").includes(claim);
  }
  if(claim.includes("@")||claim.startsWith("http")){
    return evidence.includes(claim);
  }
  if(/^\+?\d{10,13}$/.test(claim)){
    return evidence.replace(/[\s()-]/g,"").includes(claim);
  }
  return evidence.replace(/,/g,"").includes(claim);
}

export function literalGroundingCheck(answer,evidenceRows){
  const claims=extractedClaims(answer);
  if(!claims.length)return {ok:true,claims:[],missing:[]};

  const evidence=(Array.isArray(evidenceRows)?evidenceRows:[])
    .map(x=>String(x?.fact_value??x?.value??x??""))
    .join("\n");

  const missing=claims.filter(claim=>!evidenceContains(claim,evidence));
  return {ok:missing.length===0,claims,missing};
}
