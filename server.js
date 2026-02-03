const express = require("express");
const bodyParser = require("body-parser");
const QRCode = require("qrcode");
const path = require("path");
const dotenv = require('dotenv');
const { OAuth2Client } = require('google-auth-library');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const cors = require('cors');
const mongoose = require('mongoose');
const { put } = require('@vercel/blob');

// Load environment variables from .env file
dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
// Ensure 'public' is available for static files (e.g., HTML, CSS)
app.use(express.static("public")); 
app.use(cors());

// --- START: VERCEL SERVERLESS CONNECTION CACHING ---
// Cache the connection object across warm invocations
let cachedDb = null;

async function connectToDatabase() {
    // 1. Check if the connection is already cached
    if (cachedDb && cachedDb.connections[0].readyState === 1) { // 💡 IMPROVEMENT: Check readyState
        console.log('Using existing database connection. 🟢');
        return cachedDb;
    }

    // 2. Establish a new connection and cache it
    try {
        // Mongoose automatically handles connection pooling
        // NOTE: This relies on process.env.MONGO_URI being set correctly in Vercel.
        const db = await mongoose.connect(process.env.MONGO_URI);
        console.log("New MongoDB connection established. 🟢");
        cachedDb = db;
        return db;
    } catch (err) {
        console.error("MongoDB connection error:", err);
        // Throwing an error stops execution and prevents API routes from running
        throw new Error('Failed to connect to database.');
    }
}

// Middleware to ensure a database connection is ready for every API route
app.use(async (req, res, next) => {
    // Only apply to routes that need the database
    // 💡 IMPROVEMENT: Apply to all routes in case of future changes, or keep only for /api/
    if (req.path.startsWith('/api/') || req.path === '/donate') { 
        try {
            await connectToDatabase();
        } catch (error) {
            // If connection fails, stop the request chain
            return res.status(503).json({ message: 'Service Unavailable: Cannot connect to database.' });
        }
    }
    next();
});

// --- END: VERCEL SERVERLESS CONNECTION CACHING ---


// Define Mongoose Schemas and Models
const donatorSchema = new mongoose.Schema({
    id: String,
    name: String,
    email: { type: String, required: true, unique: true }, // 💡 IMPROVEMENT: Email should be unique/required
    profilePic: String,
    registrationDate: { type: Date, default: Date.now }
});
const Donator = mongoose.model('Donator', donatorSchema);

const caseSchema = new mongoose.Schema({
    patient_id: { type: String, required: true, unique: true }, // 💡 IMPROVEMENT: ID should be unique/required
    patient_name: { type: String, required: true },
    medical_condition: String,
    description: String,
    requested_amount: Number,
    images: [String], // Array of image URLs
    status: { type: String, default: 'Pending' },
    date_added: { type: Date, default: Date.now }
});
const Case = mongoose.model('Case', caseSchema);

const donationSchema = new mongoose.Schema({
    name: String,
    email: String,
    amount: { type: Number, required: true }, // 💡 IMPROVEMENT: Amount should be required
    date: { type: Date, default: Date.now },
    status: { type: String, default: 'Pending' },
    rejectionReason: String,
    transactionId: String,
});
const Donation = mongoose.model('Donation', donationSchema);


// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Multer to use in-memory storage, preventing Vercel file system errors
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Redirect the root URL to the dashboard
app.get("/", (req, res) => {
    res.redirect("/dashboard.html");
});

// Route to handle donation form submission and save to MongoDB
app.post("/donate", async (req, res) => {
    const { amount, name, email } = req.body;
    
    // Basic validation
    if (!amount || isNaN(Number(amount))) {
        return res.status(400).send("❌ Invalid or missing donation amount.");
    }

    const upiLink = `upi://pay?pa=${process.env.UPI_ID}&pn=${encodeURIComponent(
        name || "CareFund"
    )}&am=${amount}&cu=INR`;

    try {
        const qrImage = await QRCode.toDataURL(upiLink);
        
        // Create a new Donation document and save it to MongoDB
        const newDonation = new Donation({
            name: name,
            email: email,
            amount: amount,
        });

        await newDonation.save(); // Don't need the savedDonation variable here

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Complete Your Donation</title>
                <link rel="preconnect" href="https://fonts.googleapis.com">
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" rel="stylesheet">
                <style>
                    body {
                        font-family: 'Poppins', sans-serif;
                        background: #f8f9fa;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        min-height: 100vh;
                        margin: 0;
                        color: #333;
                    }
                    .qr-card {
                        background: #fff;
                        padding: 40px;
                        border-radius: 16px;
                        text-align: center;
                        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.1);
                        width: 400px;
                        max-width: 90%;
                    }
                    h1 { color: #34495e; font-size: 28px; }
                    img { margin: 25px 0; width: 220px; height: 220px; }
                    .info-text { font-size: 18px; font-weight: 600; color: #555; }
                    .amount-text { color: #007bff; font-size: 22px; font-weight: 700; }
                    .btn-group {
                        margin-top: 30px;
                        display: flex;
                        flex-direction: column;
                        gap: 15px;
                    }
                    .pay-btn, .back-btn {
                        padding: 15px;
                        border-radius: 10px;
                        font-size: 16px;
                        font-weight: 600;
                        text-decoration: none;
                        transition: background 0.3s, transform 0.2s, box-shadow 0.3s;
                    }
                    .pay-btn {
                        background: #28a745;
                        color: #fff;
                        border: none;
                    }
                    .pay-btn:hover {
                        background: #218838;
                        transform: translateY(-2px);
                        box-shadow: 0 4px 10px rgba(40, 167, 69, 0.3);
                    }
                    .back-btn {
                        background: #6c757d;
                        color: #fff;
                        border: none;
                    }
                    .back-btn:hover {
                        background: #5a6268;
                        transform: translateY(-2px);
                        box-shadow: 0 4px 10px rgba(108, 117, 125, 0.3);
                    }
                </style>
            </head>
            <body>
                <div class="qr-card">
                    <h1>Scan & Pay</h1>
                    <p class="info-text">Donation Amount: <span class="amount-text">₹${amount}</span></p>
                    <img src="${qrImage}" alt="UPI QR Code" />
                    <div class="btn-group">
                        <a class="pay-btn" href="${upiLink}">Pay Now with UPI App</a>
                        <a class="back-btn" href="/">⬅ Back to Form</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        console.error("Error generating QR code or saving donation:", err);
        res.status(500).send("❌ An error occurred. Please try again later.");
    }
});

// Route for Google Sign-in registration
app.post('/api/donater/google-register', async (req, res) => {
    const idToken = req.body.id_token;
    // 💡 IMPROVEMENT: Check for missing token early
    if (!idToken) {
        return res.status(400).json({ message: 'ID token missing.' });
    }
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    
    try {
        const ticket = await client.verifyIdToken({
            idToken: idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        
        let donator = await Donator.findOne({ email: payload.email });
        if (donator) {
            // Success response for existing user, includes donator data
            return res.status(200).json({ message: 'Welcome back! You are already registered.', donator: donator, redirect: '/user-dashboard.html' });
        }
        
        const newDonator = new Donator({
            id: payload.sub,
            name: payload.name,
            email: payload.email,
            profilePic: payload.picture,
        });
        donator = await newDonator.save();
        
        console.log('New donator registered:', donator);
        // Success response for new user, includes donator data
        res.status(200).json({ message: 'Registration successful!', donator: donator, redirect: '/user-dashboard.html' });
        
    } catch (error) {
        console.error('Google login verification failed:', error);
        res.status(401).json({ message: 'Authentication failed. Please try again.' });
    }
});

// Admin login route
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'carefund';
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SJCHS@123';

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        res.status(200).json({ message: 'Login successful!', redirect: '/admin-dashboard.html' });
    } else {
        res.status(401).json({ message: 'Invalid username or password.' });
    }
});

// Fetch donators from MongoDB
app.get('/api/admin/donators', async (req, res) => {
    try {
        const donators = await Donator.find().sort({ registrationDate: -1 });
        res.json(donators);
    } catch (error) {
        console.error('Error fetching donators from database:', error);
        res.status(500).json({ message: 'Error fetching donators.' });
    }
});

// Fetch donations from MongoDB
app.get('/api/admin/donations', async (req, res) => {
    try {
        const donations = await Donation.find().sort({ date: -1 });
        res.json(donations);
    } catch (error) {
        console.error('Error fetching donations from database:', error);
        res.status(500).json({ message: 'Error fetching donations.' });
    }
});

// Endpoint for approving a donation in MongoDB
app.post('/api/admin/approve-donation', async (req, res) => {
    const { id, transactionId } = req.body;
    try {
        const updatedDonation = await Donation.findByIdAndUpdate(
            id,
            { status: 'Approved', transactionId: transactionId },
            { new: true }
        );

        if (updatedDonation) {
            res.status(200).json({ message: 'Donation approved successfully.' });
        } else {
            res.status(404).json({ message: 'Donation not found.' });
        }
    } catch (error) {
        console.error('Error approving donation:', error);
        res.status(500).json({ message: 'Error approving donation.' });
    }
});

// Endpoint for rejecting a donation in MongoDB
app.post('/api/admin/reject-donation', async (req, res) => {
    const { id, reason } = req.body;
    try {
        const updatedDonation = await Donation.findByIdAndUpdate(
            id,
            { status: 'Rejected', rejectionReason: reason },
            { new: true }
        );

        if (updatedDonation) {
            res.status(200).json({ message: 'Donation rejected successfully.' });
        } else {
            res.status(404).json({ message: 'Donation not found.' });
        }
    } catch (error) {
        console.error('Error rejecting donation:', error);
        res.status(500).json({ message: 'Error rejecting donation.' });
    }
});

// Logic to save and retrieve cases from MongoDB Atlas
app.route('/api/admin/cases')
    .get(async (req, res) => {
        try {
            // Retrieve all cases from the 'cases' collection
            const cases = await Case.find().sort({ date_added: -1 });
            res.json(cases);
        } catch (error) {
            console.error('Error fetching cases from database:', error);
            res.status(500).json({ message: 'Error fetching cases.' });
        }
    })
    .post(upload.array('images', 5), async (req, res) => {
        try {
            // Placeholder for image upload (Vercel Blob)
            const uploadPromises = req.files.map(file => put(file.originalname, file.buffer, { access: 'public' }));
            const uploadedBlobs = await Promise.all(uploadPromises);
            const imageUrls = uploadedBlobs.map(blob => blob.url);

            // Capture data from the form body
            const { patientId, patientName, medicalCondition, description, requestedAmount } = req.body; 
            
            // 💡 IMPROVEMENT: Basic validation for required fields
            if (!patientId || !patientName || !requestedAmount) {
                return res.status(400).json({ message: 'Missing required case fields: Patient ID, Name, or Requested Amount.' });
            }

            // Create a new Case document and save it to MongoDB
            const newCase = new Case({
                patient_id: patientId, // Map the patientId to the new schema field
                patient_name: patientName,
                medical_condition: medicalCondition,
                description: description,
                requested_amount: requestedAmount,
                images: imageUrls,
            });

            const savedCase = await newCase.save();

            console.log('New case added with image URLs:', savedCase);
            res.status(201).json({ message: 'Case added successfully!', case: savedCase });

        } catch (error) {
            // Handle duplicate key error from MongoDB for patient_id
            if (error.code === 11000) {
                 return res.status(409).json({ message: `Case with Patient ID '${req.body.patientId}' already exists.` });
            }
            console.error('Error adding case or uploading images:', error);
            res.status(500).json({ message: 'Error adding case. Please try again.' });
        }
    });

// Retrieve cases from MongoDB Atlas for the public page
app.get('/api/public/cases', async (req, res) => {
    try {
        // Retrieve only approved cases if you want to show only active campaigns
        const cases = await Case.find().sort({ date_added: -1 });
        res.json(cases);
    } catch (error) {
        console.error('Error fetching public cases from database:', error);
        res.status(500).json({ message: 'Error fetching public cases.' });
    }
});

// API endpoint to get public stats from MongoDB
app.get('/api/public/stats', async (req, res) => {
    try {
        const totalDonations = await Donation.aggregate([
            { $match: { status: 'Approved' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const totalDonators = await Donator.countDocuments();
        const patientsHelped = await Case.countDocuments({ status: 'Approved' }); // 💡 IMPROVEMENT: Only count approved cases
        const totalRequests = await Case.countDocuments(); // All requests

        const stats = {
            totalDonations: totalDonations.length > 0 ? totalDonations[0].total : 0,
            totalDonators: totalDonators,
            patientsHelped: patientsHelped, 
            totalRequests: totalRequests // Differentiate between requests and helped
        };
        res.json(stats);
    } catch (error) {
        console.error('Error fetching public stats:', error);
        res.status(500).json({ message: 'Error fetching public stats.' });
    }
});

// API endpoint to get a user's donations
app.post('/api/my-donations', async (req, res) => {
    const userEmail = req.body.email;
    // 💡 IMPROVEMENT: Basic validation for email
    if (!userEmail) {
        return res.status(400).json({ message: 'User email is required.' });
    }
    try {
        const myDonations = await Donation.find({ email: userEmail }).sort({ date: -1 });
        res.json(myDonations);
    } catch (error) {
        console.error('Error fetching donations for user:', error);
        res.status(500).json({ message: 'Error fetching your donations.' });
    }
});

// ❌ CRITICAL FIX: The previous logic was mixing chat.sendMessage() with pre-existing history.
app.post('/api/chat', async (req, res) => {
    try {
        const { history } = req.body;
        
        if (!Array.isArray(history) || history.length === 0) {
            return res.status(400).json({ response: 'Invalid request: Chat history is required and cannot be empty.' });
        }
        
        // The last message is the user's new query
        const newMessage = history[history.length - 1];
        
        // Extract the actual user message content
        const userQueryParts = newMessage.parts; 

        // The chat history passed to startChat should contain all previous messages
        const previousHistory = history.slice(0, -1);
        
        // 💡 FIX: Start the chat with the correct history, and only send the NEW message.
        const chat = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).startChat({
            history: previousHistory, // Pass only the PREVIOUS history
            config: { // Use 'config' instead of 'generationConfig' for startChat
                maxOutputTokens: 100,
            },
        });
        
        // Send the user's new message
        const result = await chat.sendMessage({ role: newMessage.role, parts: userQueryParts });
        const text = result.text; // Get text directly from the result
        
        res.json({ response: text });

    } catch (error) {
        console.error('Gemini API error:', error);
        res.status(500).json({ response: 'Sorry, I am unable to respond right now.' });
    }
});


// Static file routes
app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/admin-dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

app.get('/user-dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'user-dashboard.html'));
});

app.get('/my-donations.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'my-donations.html'));
});

// Global 404 handler: Redirect to dashboard.html instead of just sending it
app.use((req, res) => {
    // 💡 IMPROVEMENT: For a true 404 page, use res.status(404).sendFile(...)
    // If the goal is redirection, use res.redirect('/dashboard.html');
    res.status(404).sendFile(path.join(__dirname, 'public', 'dashboard.html')); 
});

// --- CRITICAL VERCEL EXPORT: REPLACE app.listen() ---
// Vercel expects the app instance to be exported, not run its own server.
module.exports = app;
