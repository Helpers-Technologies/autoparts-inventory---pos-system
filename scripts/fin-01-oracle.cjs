// Independent rational arithmetic. No PartFlow calculation imports.
function rational(value) {
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new Error('NONFINITE_OR_INVALID_ORACLE_INPUT:' + String(value));
  const fraction = match[3] || '';
  const exp = Number(match[4] || 0) - fraction.length;
  let n = BigInt(match[2] + fraction) * (match[1] ? -1n : 1n), d = 1n;
  if (exp >= 0) n *= 10n ** BigInt(exp); else d = 10n ** BigInt(-exp);
  return { n, d };
}
const add = (a,b) => ({n:a.n*b.d+b.n*a.d,d:a.d*b.d});
const sub = (a,b) => ({n:a.n*b.d-b.n*a.d,d:a.d*b.d});
const mul = (a,b) => ({n:a.n*b.n,d:a.d*b.d});
const div = (a,b) => ({n:a.n*b.d,d:a.d*b.n});
const number = a => Number(a.n)/Number(a.d);
const exact = a => `${a.n}/${a.d}`;
const sum = values => values.reduce((s,x)=>add(s,rational(x)),rational(0));
function invoice(lines,discount=0,shipping=0) {
  return add(sub(lines.reduce((s,l)=>add(s,mul(rational(l.price),rational(l.quantity))),rational(0)),rational(discount)),rational(shipping));
}
function split(obligation,tender) {
  const net=number(obligation), paid=number(tender);
  return {paid:Math.min(net,paid),remaining:Math.max(0,net-paid),credit:Math.max(0,paid-net)};
}
function rng(seed) { let state=seed>>>0; return () => {state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;}; }
module.exports={rational,add,sub,mul,div,number,exact,sum,invoice,split,rng};
