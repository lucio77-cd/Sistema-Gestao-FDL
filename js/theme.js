const KEY="fdl-theme-preference";
const VALUES=["light","dark","system"];
export function getThemePreference(){try{const value=localStorage.getItem(KEY);return VALUES.includes(value)?value:"dark";}catch{return "dark";}}
function isDark(value){if(value==="dark")return true;if(value==="light")return false;return window.matchMedia?.("(prefers-color-scheme: dark)").matches??true;}
export function applyTheme(value=getThemePreference()){
 const dark=isDark(value);document.documentElement.dataset.theme=dark?"dark":"light";
 const sheet=document.getElementById("theme-dark-stylesheet");if(sheet)sheet.media=dark?"all":"not all";
 const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=dark?"#171B20":"#F4F6F7";
}
export function setThemePreference(value){if(!VALUES.includes(value))return;try{localStorage.setItem(KEY,value);}catch(error){console.warn("Não foi possível salvar a aparência.",error);}applyTheme(value);}
applyTheme();
if(window.matchMedia){const media=window.matchMedia("(prefers-color-scheme: dark)");media.addEventListener?.("change",()=>{if(getThemePreference()==="system")applyTheme("system");});}
