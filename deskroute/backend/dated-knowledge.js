// Explicit dates select approved evidence for that day, never today's prices.
// Dated answers remain staff-reviewed until business time-zone handling is verified.
const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const stop = new Set('what when where which who why how the and are was were this that with from for you your our can could would please tell about have has does into there need want know much will on of in is a an per'.split(' '));
const monthPattern = months.join('|');
const dateHints = `${months.filter(x=>x!=='may').join('|')}|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|tomorrow|yesterday|next|future`;
const mayHint = /\b(?:in|from|during|by|next|this|last)\s+may\b|\b\d{1,2}(?:st|nd|rd|th)?\s+may\b|\bmay\s+\d/;

export function questionDate(question) {
  const text = String(question).toLowerCase(), found = [];
  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  const named = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\s+(\\d{4})\\b`, 'g');
  const us = new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(\\d{4})\\b`, 'g');
  for (const m of text.matchAll(iso)) found.push({year:+m[1],month:+m[2],day:+m[3],text:m[0]});
  for (const m of text.matchAll(named)) found.push({year:+m[3],month:months.indexOf(m[2])+1,day:+m[1],text:m[0]});
  for (const m of text.matchAll(us)) found.push({year:+m[3],month:months.indexOf(m[1])+1,day:+m[2],text:m[0]});
  const hasDateHint = new RegExp(`\\b(${dateHints})\\b|\\b\\d{1,4}[-/]\\d{1,2}[-/]\\d{1,4}\\b`).test(text) || mayHint.test(text);
  if (!found.length) return {date:null,requiresHuman:hasDateHint};
  const dates = new Set();
  let remaining = text;
  for (const part of found) {
    const day = new Date(Date.UTC(part.year,part.month-1,part.day));
    if (part.year < 1900 || part.year > 2100 || day.getUTCFullYear() !== part.year || day.getUTCMonth()+1 !== part.month || day.getUTCDate() !== part.day) return {date:null,requiresHuman:true};
    dates.add(day.toISOString().slice(0,10));
    remaining = remaining.replace(part.text,' ');
  }
  // A second partial/relative date makes the intended time span ambiguous.
  if (dates.size !== 1 || new RegExp(`\\b(${dateHints}|today)\\b|\\b\\d{1,4}[-/]\\d{1,2}[-/]\\d{1,4}\\b`).test(remaining) || mayHint.test(remaining)) return {date:null,requiresHuman:true};
  const date = [...dates][0], start = `${date}T00:00:00.000Z`;
  return {date,start,end:new Date(Date.parse(start)+86400000).toISOString(),requiresHuman:true};
}

export async function datedKnowledge(admin, config, question, context) {
  if (!context.date) return {data:[],error:null};
  // The bounded query fails closed rather than choosing from an incomplete result.
  let query = admin.from('cxroute_knowledge_facts')
    .select('id,organisation_id,brand_id,review_status,fact_key,fact_value,category,confidence,valid_from,valid_until')
    .eq('organisation_id',config.organisation_id).eq('review_status','approved');
  if (config.brand_id) query = query.eq('brand_id',config.brand_id);
  else query = query.is('brand_id',null);
  const result = await query.or(`valid_from.is.null,valid_from.lt.${context.end}`)
    .or(`valid_until.is.null,valid_until.gt.${context.start}`).order('id',{ascending:true}).limit(201);
  if (result.error) return result;
  if (!Array.isArray(result.data) || result.data.length > 200) return {data:[],error:null,incomplete:true};
  const tokens = [...new Set(String(question).toLowerCase().match(/[\p{L}]{3,}/gu) || [])]
    .filter(x=>!stop.has(x)&&!months.includes(x));
  const pricing = /\b(price|prices|pricing|cost|costs|fee|fees|rate|rates|much)\b/i.test(question);
  const start = Date.parse(context.start), end = Date.parse(context.end);
  const rows = result.data.filter(f=>f.organisation_id === config.organisation_id
    && (f.brand_id ?? null) === (config.brand_id ?? null) && f.review_status === 'approved'
    && (f.valid_from == null || Date.parse(f.valid_from) < end)
    && (f.valid_until == null || Date.parse(f.valid_until) > start));
  const data = rows.map(f=>{
    const text = `${f.fact_key} ${f.fact_value} ${f.category}`.toLowerCase().replaceAll('_',' ');
    const overlap = tokens.filter(t=>text.includes(t)).length;
    const relevance = Math.min(.8,overlap*.1) + (pricing && f.category === 'pricing' ? .6 : 0);
    return {...f,relevance};
  }).filter(f=>f.relevance > 0).sort((a,b)=>b.relevance-a.relevance || String(a.id).localeCompare(String(b.id)));
  // A truncated relevant set could hide conflicting facts; let staff resolve it.
  if (data.length > 8) return {data:[],error:null,incomplete:true};
  return {data,error:null};
}
