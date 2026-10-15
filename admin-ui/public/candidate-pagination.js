export const PAGE_SIZE=10;
export function candidatePageInfo(total,offset=0){
  const totalPages=Math.ceil(total/PAGE_SIZE),currentPage=totalPages?Math.min(totalPages,Math.floor(offset/PAGE_SIZE)+1):0;
  return {totalPages,currentPage};
}
export function candidatePageNumbers(current,total){
  if(total<1)return [];
  if(total<=7)return Array.from({length:total},(_,index)=>index+1);
  const start=Math.max(2,Math.min(current-1,total-3)),end=Math.min(total-1,Math.max(current+1,4));
  const chosen=[1,...Array.from({length:end-start+1},(_,index)=>start+index),total],result=[];
  for(const page of chosen){
    const last=result.at(-1);
    if(typeof last==='number'&&page-last===2)result.push(last+1);
    else if(typeof last==='number'&&page-last>2)result.push('…');
    result.push(page);
  }
  return result;
}
