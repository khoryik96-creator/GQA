package main

import (
 "bytes"
 "encoding/json"
 "io"
 "net/http"
 "net/url"
 "os"
 "strings"
 "time"
)

func brokerJobURL(path string)(string,bool){
 if os.Getenv("GQA_JOB_MANAGEMENT_ENABLED")!="true"{return "",false}
 base,err:=url.Parse(os.Getenv("GQA_RUNNER_URL"))
 if err!=nil || base.Scheme!="http" || base.Host!="host.docker.internal:18090" ||
   base.Path!="/run" || base.RawQuery!="" || base.User!=nil {return "",false}
 if !strings.HasPrefix(path,"/jobs"){return "",false}
 return "http://host.docker.internal:18090"+path,true
}

func (s *server) brokerJobs(w http.ResponseWriter,r *http.Request){
 path:="/jobs"
 if r.PathValue("id")!="" {
   if !uuidRE.MatchString(r.PathValue("id")){fail(w,400,"Invalid job identity");return}
   path+="/"+r.PathValue("id")
   if r.Method==http.MethodPost{path+="/cancel"}
 }
 endpoint,enabled:=brokerJobURL(path)
 if !enabled {
   fail(w,http.StatusNotImplemented,"Experimental job management is disabled");return
 }
 method:=r.Method
 if method!=http.MethodGet && method!=http.MethodPost {
   fail(w,405,"Method not allowed");return
 }
 request,err:=http.NewRequestWithContext(r.Context(),method,endpoint,nil)
 if err!=nil{fail(w,500,"Unable to prepare broker request");return}
 request.Header.Set("X-GQA-Runner-Token",os.Getenv("GQA_RUNNER_TOKEN"))
 client:=&http.Client{Timeout:5*time.Second,CheckRedirect:func(*http.Request,[]*http.Request)error{
   return http.ErrUseLastResponse
 }}
 response,err:=client.Do(request)
 if err!=nil{fail(w,502,"Job broker is unavailable");return}
 defer response.Body.Close()
 if response.StatusCode!=200 && response.StatusCode!=404 {
   fail(w,502,"Job broker declined request");return
 }
 raw,err:=io.ReadAll(io.LimitReader(response.Body,65537))
 if err!=nil || len(raw)>65536 || !json.Valid(raw) {
   fail(w,502,"Invalid job broker response");return
 }
 w.Header().Set("Content-Type","application/json")
 w.Header().Set("Cache-Control","no-store")
 w.WriteHeader(response.StatusCode)
 _,_=w.Write(raw)
}

func (s *server) brokerScreenshot(w http.ResponseWriter,r *http.Request){
 id:=r.PathValue("id")
 if !uuidRE.MatchString(id){fail(w,400,"Invalid job identity");return}
 endpoint,enabled:=brokerJobURL("/jobs/"+id+"/screenshot")
 if !enabled{fail(w,501,"Experimental broker screenshots are disabled");return}
 request,err:=http.NewRequestWithContext(r.Context(),http.MethodGet,endpoint,nil)
 if err!=nil{fail(w,500,"Cannot create broker evidence request");return}
 request.Header.Set("X-GQA-Runner-Token",os.Getenv("GQA_RUNNER_TOKEN"))
 client:=&http.Client{Timeout:5*time.Second,CheckRedirect:func(*http.Request,[]*http.Request)error{
  return http.ErrUseLastResponse
 }}
 response,err:=client.Do(request)
 if err!=nil{fail(w,502,"Broker evidence unavailable");return}
 defer response.Body.Close()
 if response.StatusCode==404{fail(w,404,"Screenshot not found");return}
 if response.StatusCode!=200||response.Header.Get("Content-Type")!="image/png"{
  fail(w,502,"Unexpected screenshot response");return
 }
 raw,err:=io.ReadAll(io.LimitReader(response.Body,1000001))
 if err!=nil||len(raw)<8||len(raw)>1000000||
    !bytes.Equal(raw[:8],[]byte{137,80,78,71,13,10,26,10}){
  fail(w,502,"Invalid screenshot content");return
 }
 w.Header().Set("Content-Type","image/png")
 w.Header().Set("Cache-Control","no-store")
 w.Header().Set("X-Content-Type-Options","nosniff")
 w.WriteHeader(200)
 _,_=w.Write(raw)
}
