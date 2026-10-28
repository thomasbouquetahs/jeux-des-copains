# Jeux des copains

## Les Camemberts
Quiz de culture générale façon jeu de plateau, à afficher sur la TV.

- **TV** : ouvrir https://thomasbouquetahs.github.io/jeux-des-copains/
- **Téléphones** : scanner le QR code affiché sur la TV → le téléphone devient une manette (lancer le dé, choisir la case, voir la réponse, juger).

La TV reste maître de la partie. TV et téléphones communiquent via un relais MQTT public (WebSocket sécurisé), ce qui marche en 4G/5G comme en Wi-Fi, sans compte ni appli. Si le relais principal ne répond pas, la TV et les téléphones basculent automatiquement sur un relais de secours.

On peut aussi rejoindre sans QR code : ouvrir `thomasbouquetahs.github.io/jeux-des-copains/m` et taper le code à 4 caractères affiché sur la TV.
