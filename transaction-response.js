// Publish a success response only after the database has committed it.
module.exports=function transactionResponse(db,handler) {
  return async(req,res)=>{
    const json=res.json;let body,sent=false;
    res.json=value=>{body=value;sent=true;return res;};
    try {await db.transaction(()=>handler(req,res)).immediate();}
    finally {res.json=json;}
    if(sent)return res.json(body);
  };
};
