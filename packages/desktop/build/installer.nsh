; DotaStat kurulum/kaldirma eklentileri (electron-builder NSIS).
;
; NEDEN VAR: uygulama, Windows oturum acilisinda kalkmak icin kullaniciya ait
; Run kaydini yaziyor (bkz. src/services/auto-launch.js). Bu kayit uygulamanin
; KENDI yazdigi bir sey oldugu icin electron-builder'in kaldirma adimi ondan
; haberdar degil ve kaldirma sonrasi kayit ortada kaliyordu: her acilista
; Windows artik var olmayan bir exe'yi calistirmaya calisiyor.
;
; Deger adi `LOGIN_ITEM_NAME` ile AYNI olmali (auto-launch.js). Ikisinden biri
; degisirse kayit temizlenmeden kalir.

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DotaStat"
!macroend
