/**
 * Seed Relance SMS Templates
 *
 * Inserts Rufus's predefined auto (J0–J7) and manual (Day 1–7) SMS templates.
 * Safe to re-run — uses upsert so existing templates are updated, not duplicated.
 *
 * Usage: NODE_ENV=production node scripts/seed-sms-templates.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const NOTIFICATION_DB_URI = NODE_ENV === 'production'
    ? process.env.NOTIFICATION_MONGODB_URI_PROD || 'mongodb://localhost:27017/sbc_notification_prod'
    : process.env.NOTIFICATION_MONGODB_URI_DEV || 'mongodb://localhost:27017/sbc_notification_dev';

const RelanceSmsTemplateSchema = new mongoose.Schema({
    type: String,
    dayNumber: Number,
    templateText: String,
    active: { type: Boolean, default: true }
}, { timestamps: true });

// Auto relance templates (J0–J7), {{link}} = referrer's custom link
const AUTO_TEMPLATES = [
    {
        dayNumber: 0,
        templateText: "Tu t'es inscrit… mais tu n'as rien activé.\nPendant que tu attends, d'autres commencent déjà.\n👉 Active ici : {{link}}"
    },
    {
        dayNumber: 1,
        templateText: "SBC = formations + produits digitaux à revendre 💰\nTu peux apprendre et gagner en même temps.\n👉 Accès ici : {{link}}"
    },
    {
        dayNumber: 2,
        templateText: "Ces messages que tu reçois…\nc'est du SMS marketing.\nTu peux apprendre à faire pareil et gagner avec ça dans SBC.\n👉 {{link}}"
    },
    {
        dayNumber: 3,
        templateText: "Beaucoup échouent ici par hésitation.\nPas par manque d'opportunité.\nNe reste pas bloqué.\n👉 {{link}}"
    },
    {
        dayNumber: 4,
        templateText: "5 à 10.000fcfa/jour\nTu apprends + tu revends + tu gagnes.\nPourquoi tu n'as pas encore commencé ?\n👉 {{link}}"
    },
    {
        dayNumber: 5,
        templateText: "Dans 30 jours, soit tu avances…\nsoit rien ne change.\nLa décision se prend aujourd'hui.\n👉 {{link}}"
    },
    {
        dayNumber: 6,
        templateText: "Regarder ne rapporte rien.\nPasser à l'action change tout.\nTu fais quoi maintenant ?\n👉 {{link}}"
    },
    {
        dayNumber: 7,
        templateText: "Tu continues à réfléchir ?\nApprend à gagner 5 à 10.000/jour!\ntu veux rejoindre SBC :\n👉 {{link}}"
    },
];

// Manual relance templates (Day 1–7)
const MANUAL_TEMPLATES = [
    {
        dayNumber: 1,
        templateText: "Salut 👋\nTu t'étais inscrit sur SBC sans finaliser.\nToujours intéressé pour générer des revenus en ligne ?\n👉 {{link}}"
    },
    {
        dayNumber: 2,
        templateText: "Dis-moi franchement :\nqu'est-ce qui te bloque ?\nManque d'argent, temps ou doute ?\nJe peux t'aider 👉 {{link}}"
    },
    {
        dayNumber: 3,
        templateText: "SBC = formations + produits digitaux à revendre 💰\nTu apprends et tu gagnes.\nTu veux commencer ?\n👉 {{link}}"
    },
    {
        dayNumber: 4,
        templateText: "Ce message que tu lis…\nc'est du SMS marketing.\nTu peux apprendre ça et gagner avec dans SBC.\n👉 {{link}}"
    },
    {
        dayNumber: 5,
        templateText: "Beaucoup s'inscrivent…\npeu passent à l'action.\nEt ce sont toujours les mêmes qui avancent.\nTu fais quoi ?\n👉 {{link}}"
    },
    {
        dayNumber: 6,
        templateText: "Dans 30 jours, tu peux avancer…\nou rester au même point.\nLa décision est simple.\n👉 {{link}}"
    },
    {
        dayNumber: 7,
        templateText: "Je peux t'aider à démarrer aujourd'hui.\nMais il faut décider.\nTu es prêt ?\n👉 {{link}}"
    },
];

async function main() {
    console.log(`[Seed] Seeding SMS templates (env: ${NODE_ENV})`);
    const conn = await mongoose.createConnection(NOTIFICATION_DB_URI).asPromise();
    const RelanceSmsTemplate = conn.model('RelanceSmsTemplate', RelanceSmsTemplateSchema);

    let upserted = 0;

    for (const tpl of AUTO_TEMPLATES) {
        await RelanceSmsTemplate.updateOne(
            { type: 'auto', dayNumber: tpl.dayNumber },
            { $set: { templateText: tpl.templateText, active: true } },
            { upsert: true }
        );
        upserted++;
    }

    for (const tpl of MANUAL_TEMPLATES) {
        await RelanceSmsTemplate.updateOne(
            { type: 'manual', dayNumber: tpl.dayNumber },
            { $set: { templateText: tpl.templateText, active: true } },
            { upsert: true }
        );
        upserted++;
    }

    console.log(`[Seed] Done — ${upserted} templates upserted (${AUTO_TEMPLATES.length} auto + ${MANUAL_TEMPLATES.length} manual)`);
    await conn.close();
}

main().catch(err => {
    console.error('[Seed] Fatal error:', err);
    process.exit(1);
});
