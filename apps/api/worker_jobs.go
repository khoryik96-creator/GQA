package main

import (
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
   if r.Method==http.MethodPost{path+="/cancel"
   }else if strings.HasSuffix(r.URL.Path,"/result"){path+="/result"}
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
 maxSize:=65536
 if strings.HasSuffix(path,"/result"){maxSize=2<<20}
 raw,err:=io.ReadAll(io.LimitReader(response.Body,int64(maxSize+1)))
 if err!=nil || len(raw)>maxSize || !json.Valid(raw) {
   fail(w,502,"Invalid job broker response");return
 }
 w.Header().Set("Content-Type","application/json")
 w.Header().Set("Cache-Control","no-store")
 w.WriteHeader(response.StatusCode)
 _,_=w.Write(raw)
}
