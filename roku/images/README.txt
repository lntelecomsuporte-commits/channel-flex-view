# Substitua estes placeholders por imagens reais antes de publicar:
#
# - icon_focus_hd.png  → 290×218 PNG (ícone do canal no menu Roku)
# - splash_hd.jpg      → 1280×720 JPG (splash de abertura)
#
# Sugestão: pegar o mesmo ícone usado no APK em /opt/lntv-frontend/public/
# e redimensionar com:
#   convert logo.png -resize 290x218 icon_focus_hd.png
#   convert logo.png -background black -gravity center -resize 1280x720 \
#           -extent 1280x720 splash_hd.jpg
