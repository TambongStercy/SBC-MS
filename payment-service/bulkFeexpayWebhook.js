const axios = require('axios');
require('dotenv').config({ path: '../../.env' }); // Adjust path to your root .env file

const FEEXPAY_API_KEY = process.env.FEEXPAY_API_KEY;
const BASE_URL = 'https://sniperbuisnesscenter.com/api';
const WEBHOOK_ENDPOINT = `${BASE_URL}/payments/webhooks/feexpay`;

const references = [
    "0bTX2aFIJBLE",
    "WSP1690250614y220733",
    "TaIUh4a6CD5x",
    "WSP7245250614q220428",
    "WSP6692250614v200529",
    "WSP1426250614b194808",
    "WSP5352250614b183408",
    "97420802-c772-49c3-97e1-9e6073b870c5",
    "44b26788-f93e-4eb5-9ab1-fa2e461f2bbe",
    "WSP8371250614V125528",
    "WSP7437250614z121112",
    "WSP1950250614o112301",
    "WSP3953250614x103844",
    "4TAP502fSpGb",
    "0efacac2-9355-45c4-9ea7-1cf2c4593119",
    "A33523CD-CAD3-4651-AB0A-EA2741538AE7",
    "Z7zmCHAKb7n8",
    "c168f45a-aea8-43ad-af1b-a20fb89b1fc1",
    "fff60bd4-face-408a-96b9-312da2c5bfdf",
    "WSP3850250614f003650",
    "LOFYAyJ9XQLJ",
    "4362d024-54a0-4496-912a-c9e58bbc77db",
    "WSP8016250613G185743",
    "DtKigFOGVOpC",
    "WSP8037250613p184513",
    "Xl2LYlZwAbtL",
    "28112986-250f-43b5-81a9-dc723a0fc7fd",
    "WSP8915250613Y143133",
    "90998b76-8451-4be7-9ff2-f75cbe9be263",
    "9982bd38-20b9-4040-9c52-1475d6a7e4c4",
    "00d12122-3e05-4587-8aa7-4dd2d7a1660e",
    "QRPR0uxl2AyT",
    "435fd8f2-b690-43d5-be9e-d4cd90dbe4bc",
    "WSP6234250613G084421",
    "ab6106ce-19ec-4aa4-bcaf-7c41da76b37a",
    "84fba6dc-ea2c-420b-9405-9699a5709992",
    "WSP2099250613c061529",
    "fefeb6ed-2f2d-4043-b79a-b518a515441f",
    "98b482c0-71d2-4838-89d3-9bca84f873bd",
    "246523a8-8630-4e65-86c1-b4484789b3b0",
    "cd0ea409-a1f8-4955-aed1-31db2b6a3fed",
    "WSP5253250612b212749",
    "2ff967c4-21d0-46a1-8cd9-42cbd33d5147",
    "WSP5819250612o205729",
    "8Dy5u68gTn2G",
    "c5JO8Hg6f4Vk",
    "yUKvNWoLhx92",
    "WSP5187250612B185030",
    "WSP4600250612W180246",
    "XerqgfvcEw62",
    "AG_220250612_702038bece3e2854070f",
    "WSP3094250612C165857",
    "WSP2557250612w155646",
    "sEVz9gYOAgZa",
    "d3099086-edfe-4bcc-95bd-b928931c989e",
    "LrxUqWohPEc7",
    "LDx1JkG7wLkV",
    "ef02331e-3193-4974-8247-78cc88520c49",
    "fb3ba5ce-3855-4230-a02d-ec273a991fff",
    "ef704c4e-d51b-4ed1-88c8-3d45cbbace83",
    "WSP8951250612g125416",
    "qKCJ2GXb4PU6",
    "WSP7572250612v123649",
    "WSP4466250612z115651",
    "WSP2603250612L105031",
    "TqzOIuJMrRpU",
    "h9GPZiE4rGxn",
    "acf2bb43-3d94-400e-9ded-b630682923d4",
    "d0d34c56-bfd6-4561-98c4-5f1b2f59f3a7",
    "af5c524c-4964-4294-985a-7a9641c840fe",
    "WSP8987250611L231943",
    "qGNtzTd93BmV",
    "r8vWfOUtZXYZ",
    "2ba18266-e838-4987-8d5b-45d6edf86f55",
    "99b186bd-d69e-4f90-8080-c9e50b747518",
    "WSP8606250611Z214929",
    "4afd4aef-0589-46e9-a64f-c2890cbc1df0",
    "WSP9789250611e202257",
    "L19WSC7SZdGD",
    "fb15ec23-db3e-4136-9754-ee54e792bc0a",
    "82eb2699-1f00-4bee-9229-d83c31e8eff5",
    "h2oo2GuZcc6e",
    "92BCFAA8-962D-4A6C-8586-91C554380678",
    "WSP1561250611b173006",
    "mQfLQQjd8pU6",
    "WSP6745250611f170333",
    "89pWbt3GxSzA",
    "da506fd5-4d3c-45d8-b60f-b54d13c1a7de",
    "d6d429c5-5f53-4345-aa5e-1097a1d970f9",
    "a3b6553c-fa6c-4005-807d-4c9480d6f92a",
    "9r2WUucyrWii",
    "7fadaa13-bf40-4c6f-b1d7-d73270cae498",
    "WSP2516250611m060521",
    "WSP4444250611Y011902"
];

async function sendWebhookRequests() {
    if (!FEEXPAY_API_KEY) {
        console.error('FEEXPAY_API_KEY is not set in your .env file at the root directory. Please set it.');
        return;
    }

    console.log(`Starting bulk webhook requests to ${WEBHOOK_ENDPOINT}`);

    for (const reference of references) {
        const payload = {
            reference: reference,
            status: "SUCCESSFUL" // Assuming you want to send a SUCCESSFUL status
        };

        try {
            const response = await axios.post(WEBHOOK_ENDPOINT, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${FEEXPAY_API_KEY}`
                }
            });
            console.log(`Successfully sent webhook for reference ${reference}: Status ${response.status}`);
        } catch (error) {
            console.error(`Failed to send webhook for reference ${reference}:`);
            if (error.response) {
                console.error(`  Status: ${error.response.status}`);
                console.error(`  Data: ${JSON.stringify(error.response.data)}`);
            } else if (error.request) {
                console.error('  No response received:', error.message);
            } else {
                console.error('  Error setting up request:', error.message);
            }
        }
        // Optional: Add a small delay between requests to avoid rate limiting
        // await new Promise(resolve => setTimeout(resolve, 100)); 
    }
    console.log('Bulk webhook requests completed.');
}

sendWebhookRequests(); 