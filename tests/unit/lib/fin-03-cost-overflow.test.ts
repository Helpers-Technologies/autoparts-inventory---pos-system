import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {assertMoney} from '../../../src/lib/moneySafety';
const main=createRequire(import.meta.url)('../../../electron/money-safety.cjs') as {assertMoney:typeof assertMoney};
describe('FIN-03 cost multiplication before serialization',()=>{
 for(const [layer,validate] of [['renderer',assertMoney],['main',main.assertMoney]] as const){
  it(`${layer} rejects derived positive and negative infinity even with a finite sale subtotal`,()=>{
   for(const costPrice of [1e308,-1e308])expect(()=>validate({price:0.01,quantity:10,costPrice})).toThrow(/invalid_cost_value/);
  });
  it(`${layer} preserves finite fractional, zero and signed costs without rounding`,()=>{
   for(const costPrice of [undefined,0,0.333,-0.333,1e100])expect(()=>validate({price:0.01,quantity:0.333,costPrice})).not.toThrow();
  });
 }
});
