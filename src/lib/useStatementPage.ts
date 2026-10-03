import { useEffect, useState } from "react";

export function useStatementPage<T>(kind:"customer"|"supplier",partyId:string|undefined,input:Record<string,unknown>,enabled:boolean){
  const [result,setResult]=useState<{rows:T[];total:number;balance:number;totals:{total:number;paid:number;remaining:number};loading:boolean;error:string|null}>({rows:[],total:0,balance:0,totals:{total:0,paid:0,remaining:0},loading:enabled,error:null});
  const key=JSON.stringify(input);
  useEffect(()=>{const api=window.desktopAPI?.query;if(!enabled||!api||!partyId){setResult((current)=>({...current,loading:false}));return;}let active=true;setResult((current)=>({...current,loading:true,error:null}));void api.statement(kind,partyId,input).then((response)=>{if(!active)return;if(!response.ok){setResult({rows:[],total:0,balance:0,totals:{total:0,paid:0,remaining:0},loading:false,error:response.error||"query_failed"});return;}const value=response as typeof response&{totals?:{total:number;paid:number;remaining:number}};setResult({rows:(response.rows||[]) as T[],total:response.total||0,balance:response.balance||0,totals:value.totals||{total:0,paid:0,remaining:0},loading:false,error:null});});return()=>{active=false;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[kind,partyId,enabled,key]);return result;
}
