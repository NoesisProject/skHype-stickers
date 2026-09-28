# Wizz prototype

Prototype minimal pour tester le branchement d'un widget dans Element Classic.

## Objectif de cette première version

Cette version ne tente pas encore d'envoyer un Wizz à un autre utilisateur.

Elle vérifie simplement :

1. que le widget peut être ajouté et chargé dans une conversation Element Classic;
2. que le WebView reçoit le handshake historique d'Element;
3. que JavaScript peut déclencher une petite animation locale;
4. que la vibration Android est accessible depuis le widget;
5. qu'un son court peut être lancé après une interaction utilisateur.

## Fichiers

- `index.html` : interface du widget;
- `wizz.css` : apparence et animation shake;
- `wizz.js` : handshake Element Classic et test local du Wizz.

## Étape suivante

Si ce prototype fonctionne sur Element Classic Android, la prochaine étape sera de tester le transport d'un événement entre deux instances du widget.
