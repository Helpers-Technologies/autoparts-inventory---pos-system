import { useEffect, useState } from "react";

export function useDuesParties<T>(input: Record<string, unknown>, enabled: boolean) {
  const [result,setResult]=useState<{rows:T[];total:number;loading:boolean;error:string|null}>({rows:[],total:0,loading:enabled,error:null});
  const key=JSON.stringify(input);
  useEffect(()=>{
    const api=window.desktopAPI?.query;
    if(!enabled||!api){setResult((current)=>({...current,loading:false}));return;}
    let active=true;setResult((current)=>({...current,loading:true,error:null}));
    void api.duesParties(input).then((response)=>{if(!active)return;if(!response.ok){setResult({rows:[],total:0,loading:false,error:response.error||"query_failed"});return;}setResult({rows:(response.rows||[]) as T[],total:response.total||0,loading:false,error:null});});
    return()=>{active=false;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[enabled,key]);
  return result;
}
