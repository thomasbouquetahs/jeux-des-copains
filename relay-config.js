/* Relais en ligne (MQTT sur WebSocket sécurisé) partagé par la TV et les téléphones.
   Tout passe par le serveur relais : ça marche en 4G/5G comme en Wi-Fi, sans connexion directe. */
window.RELAY={
  brokers:['wss://broker.emqx.io:8084/mqtt','wss://broker.hivemq.com:8884/mqtt','wss://test.mosquitto.org:8081'],
  topic:code=>'jdc-camemberts-v1/'+code
};
