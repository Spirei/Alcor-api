// Default old workspace keys, confirmed in fire-web/lib/settings.ts.
export const legacyNavigation:Record<string,{path:string;label:string}>={holdings:{path:'/portfolio',label:'账户资产'},assets:{path:'/portfolio',label:'资产分析'},watchlist:{path:'/portfolio',label:'自选记录'},fire:{path:'/fire',label:'FIRE'},global:{path:'/market',label:'全球资产'},trading:{path:'/feed',label:'动态'},earnings:{path:'/market',label:'财报日程'},celebs:{path:'/celebs',label:'名人持仓'},users:{path:'/users',label:'用户管理'},attachments:{path:'/attachments',label:'共享附件'},library:{path:'/shared-assets',label:'共享素材'},cards:{path:'/cards',label:'卡面'},activities:{path:'/activity',label:'活动'},settings:{path:'/settings',label:'设置'}};
export function mobileNavigation<T extends {path:string}>(items:readonly T[],order:readonly string[],mobile:boolean):T[]{
 if(!mobile||!order.length)return [...items];
 const paths=[...new Set(order.flatMap(key=>Object.hasOwn(legacyNavigation,key)?[legacyNavigation[key].path]:[]))];
 return [...items].sort((a,b)=>{const x=paths.indexOf(a.path),y=paths.indexOf(b.path);return (x<0?paths.length:x)-(y<0?paths.length:y);});
}
