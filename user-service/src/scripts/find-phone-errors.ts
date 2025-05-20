import mongoose from 'mongoose';
import UserModel from '../database/models/user.model';
import config from '../config'; // Assuming your DB URI is in config

const findProblematicPhoneNumbers = async () => {
    try {
        console.log('Attempting to connect to MongoDB to find phone errors...');
        await mongoose.connect(config.mongodb.uri);
        console.log('MongoDB connected successfully.');

        // Regex for a correctly formatted Cameroonian phone number: 237 followed by 9 digits.
        const correctCameroonPhoneRegex = /^237\d{9}$/;

        // Find users in Cameroon whose phone numbers are not null/empty 
        // AND do not match the correct format.
        const problematicUsers = await UserModel.find({
            country: 'CM', // Focus on Cameroon as per your examples
            phoneNumber: {
                $ne: null,
                $nin: ['', undefined], // Ensure it's not empty
                $not: correctCameroonPhoneRegex
            }
        }).select('_id name email phoneNumber country').lean();

        console.log(`\nFound ${problematicUsers.length} users in Cameroon with potentially problematic phone numbers:`);

        if (problematicUsers.length === 0) {
            console.log('No problematic phone numbers found for Cameroon users matching the criteria.');
        } else {
            for (const user of problematicUsers) {
                console.log(
                    `  User ID: ${user._id}, Name: ${user.name || 'N/A'}, Email: ${user.email || 'N/A'}, Phone: "${user.phoneNumber}", Country: ${user.country}`
                );
            }
        }

    } catch (error) {
        console.error('\nError finding problematic phone numbers:');
        if (error instanceof Error && error.message.includes('querySrv ENOTFOUND')) {
            console.error('MongoDB connection error: Could not resolve SRV record. Check your database URL and network connection.');
        } else {
            console.error(error);
        }
    } finally {
        if (mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
            console.log('\nMongoDB disconnected.');
        }
    }
};

findProblematicPhoneNumbers(); 