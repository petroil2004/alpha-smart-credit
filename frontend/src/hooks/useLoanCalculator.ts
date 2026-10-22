import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api";
import { calculationKey, isCurrentAnnuityResult, isProductCatalog, prepareCalculation } from "../calculator";
import type { Api, AnnuityResult, DraftFields, FieldErrors, ProductCatalog } from "../types";

export interface CalculatorState {
  catalog: ProductCatalog | null;
  catalogStatus: "loading" | "ready" | "error";
  result: AnnuityResult | null;
  status: "incomplete" | "loading" | "ready" | "invalid" | "error" | "unsupported";
  errors: FieldErrors;
  message: string | null;
  retryCatalog(): void;
  retryCalculation(): void;
}

const errorMessage = (error:unknown) => error instanceof ApiError ? error.message : "Сервис временно недоступен. Попробуйте ещё раз.";

export function useLoanCalculator(api:Api,fields:DraftFields,applicationId:string):CalculatorState {
  const [catalogAttempt,setCatalogAttempt]=useState(0);
  const [retry,setRetry]=useState(0);
  const [loaded,setLoaded]=useState<{api:Api;attempt:number;data:ProductCatalog|null;error:string|null}|null>(null);
  const [finished,setFinished]=useState<{api:Api;key:string;retry:number;data:AnnuityResult|null;error:string|null;fields:FieldErrors}|null>(null);
  const sequence=useRef(0);

  useEffect(()=>{
    let active=true;
    api.products().then(value=>{
      if (!isProductCatalog(value)) throw new Error("Invalid catalog");
      if (active) setLoaded({api,attempt:catalogAttempt,data:value,error:null});
    }).catch(error=>{if(active)setLoaded({api,attempt:catalogAttempt,data:null,error:errorMessage(error)});});
    return ()=>{active=false;};
  },[api,catalogAttempt]);

  const currentLoad=loaded?.api===api && loaded.attempt===catalogAttempt ? loaded:null;
  const catalog=currentLoad?.data??null;
  const catalogStatus=currentLoad ? currentLoad.error?"error":"ready" : "loading";
  const prepared=catalog ? prepareCalculation(fields,catalog) : {request:null,errors:{}};
  const request=prepared.request;
  // Include refresh generation so an old reply cannot revive after catalog reload.
  const key=request&&catalog ? `${calculationKey(applicationId,request,catalog.catalog_version)}:${catalogAttempt}`:null;

  useEffect(()=>{
    const number=++sequence.current;
    let active=true;
    if (!key || !request || !catalog) return ()=>{active=false;};
    const timer=setTimeout(()=>{
      api.calculateAnnuity(request).then(value=>{
        if (!active || number!==sequence.current) return;
        const changed=value?.catalog_version!==catalog.catalog_version;
        if (!isCurrentAnnuityResult(request,catalog,value)) {
          throw new Error(changed?"catalog_changed":"invalid_result");
        }
        setFinished({api,key,retry,data:value,error:null,fields:{}});
      }).catch(error=>{
        if (!active || number!==sequence.current) return;
        const message=error instanceof Error && error.message==="catalog_changed" ? "Условия изменились. Повторите загрузку условий." : errorMessage(error);
        setFinished({api,key,retry,data:null,error:message,fields:error instanceof ApiError && error.status===422?error.fields:{}});
      });
    },300);
    return ()=>{active=false;clearTimeout(timer);};
  },[api,key,retry]);

  const current=finished?.api===api && finished.key===key && finished.retry===retry ? finished:null;
  const unsupported=fields.product_code==="overdraft";
  const errors={...prepared.errors,...(current?.fields??{})};
  const status:CalculatorState["status"]=unsupported?"unsupported":catalogStatus==="error"?"error":catalogStatus==="loading"?"loading":Object.keys(errors).length?"invalid":!key?"incomplete":current?.error?"error":current?.data?"ready":"loading";
  return {
    catalog,catalogStatus,status,errors,result:status==="ready"?current!.data:null,
    message:currentLoad?.error??current?.error??null,
    retryCatalog:()=>{setCatalogAttempt(n=>n+1);},
    retryCalculation:()=>{setRetry(n=>n+1);},
  };
}
