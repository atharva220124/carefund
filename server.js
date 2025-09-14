// Import necessary modules
const express = require("express");
const bodyParser = require("body-parser");
const QRCode = require("qrcode");
const path = require("path");
const dotenv = require('dotenv');
const { OAuth2Client } = require('google-auth-library');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const cors = require('cors');
// --- NEW: Import Mongoose for MongoDB connection ---
const mongoose = require('mongoose');
const { put } = require('@vercel/blob');

// NOTE: @vercel/speed-insights is a front-end library.
// It should be added directly to your HTML files (e.g., dashboard.html) using a <script> tag,
// not imported into this Node.js backend.
// Example: <script type="module" src="/_vercel/speed-insights/script.js"></script>

// Load environment variables from .env file
dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(cors());

// --- UPDATED: Connect to MongoDB Atlas via Mongoose without deprecated options ---
mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log("MongoDB connected successfully.");
}).catch(err => {
    console.error("MongoDB connection error:", err);
});

// --- NEW: Define a Mongoose Schema and Model for Cases ---
const caseSchema = new mongoose.Schema({
    patient_name: String,
    medical_condition: String,
    description: String,
    requested_amount: Number,
    images: [String], // Array of image URLs
    status: { type: String, default: 'Pending' },
    date_added: { type: Date, default: Date.now }
});
const Case = mongoose.model('Case', caseSchema);

// --- NEW: Define a Mongoose Schema and Model for Donations ---
const donationSchema = new mongoose.Schema({
    name: String,
    email: String,
    amount: Number,
    date: { type: Date, default: Date.now },
    status: { type: String, default: 'Pending' },
    rejectionReason: String,
    transactionId: String,
});
const Donation = mongoose.model('Donation', donationSchema);


// --- FIX: Initialize Google Generative AI once at the start ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- FIX: Change Multer to use in-memory storage ---
// This prevents the 'EROFS: read-only file system' error on Vercel.
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Temporary in-memory databases (These will be replaced by Postgres for cases)
const donatorsDB = [];

// Redirect the root URL to the dashboard
app.get("/", (req, res) => {
    res.redirect("/dashboard");
});

// --- UPDATED: Route to handle donation form submission and save to MongoDB ---
app.post("/donate", async (req, res) => {
    const { amount, name, email } = req.body;
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

        const savedDonation = await newDonation.save();

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
        console.error("Error generating QR code:", err);
        res.status(500).send("❌ An error occurred. Please try again later.");
    }
});

app.post('/api/donater/google-register', async (req, res) => {
    const idToken = req.body.id_token;
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    
    try {
        const ticket = await client.verifyIdToken({
            idToken: idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        
        const existingDonator = donatorsDB.find(d => d.email === payload.email);
        if (existingDonator) {
            return res.status(200).json({ message: 'Welcome back! You are already registered.', donator: existingDonator, redirect: '/user-dashboard.html' });
        }
        
        const newDonator = {
            id: payload.sub,
            name: payload.name,
            email: payload.email,
            profilePic: payload.picture,
            registrationDate: new Date().toISOString()
        };
        donatorsDB.push(newDonator);
        
        console.log('New donator registered:', newDonator);
        res.status(200).json({ message: 'Registration successful!', donator: newDonator, redirect: '/user-dashboard.html' });
        
    } catch (error) {
        console.error('Google login verification failed:', error);
        res.status(401).json({ message: 'Authentication failed. Please try again.' });
    }
});

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

app.get('/api/admin/donators', (req, res) => {
    res.json(donatorsDB);
});

// --- UPDATED: Fetch donations from MongoDB ---
app.get('/api/admin/donations', async (req, res) => {
    try {
        const donations = await Donation.find().sort({ date: -1 });
        res.json(donations);
    } catch (error) {
        console.error('Error fetching donations from database:', error);
        res.status(500).json({ message: 'Error fetching donations.' });
    }
});

// --- UPDATED: Endpoint for approving a donation in MongoDB ---
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

// --- UPDATED: Endpoint for rejecting a donation in MongoDB ---
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

// --- UPDATED: New logic to save and retrieve cases from MongoDB Atlas ---
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

            const { patientName, medicalCondition, description, requestedAmount } = req.body;

            // Create a new Case document and save it to MongoDB
            const newCase = new Case({
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
            console.error('Error adding case or uploading images:', error);
            res.status(500).json({ message: 'Error adding case. Please try again.' });
        }
    });

// --- UPDATED: Retrieve cases from MongoDB Atlas for the public page ---
app.get('/api/public/cases', async (req, res) => {
    try {
        const cases = await Case.find().sort({ date_added: -1 });
        res.json(cases);
    } catch (error) {
        console.error('Error fetching public cases from database:', error);
        res.status(500).json({ message: 'Error fetching public cases.' });
    }
});

// --- UPDATED API ENDPOINT ---
app.post('/api/my-donations', async (req, res) => {
    const userEmail = req.body.email;
    try {
        const myDonations = await Donation.find({ email: userEmail }).sort({ date: -1 });
        res.json(myDonations);
    } catch (error) {
        console.error('Error fetching donations for user:', error);
        res.status(500).json({ message: 'Error fetching your donations.' });
    }
});

// --- FIX: Corrected AI Chatbot route ---
app.post('/api/chat', async (req, res) => {
    try {
        const { history } = req.body;
        
        if (!Array.isArray(history) || history.length === 0) {
            return res.status(400).json({ response: 'Invalid request: Chat history is required and cannot be empty.' });
        }
        
        if (history[0].role === 'model') {
            history.shift();
        }
        
        const chat = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).startChat({
            history: history,
            generationConfig: {
                maxOutputTokens: 100,
            },
        });
        
        const userQueryParts = history[history.length - 1].parts;
        const result = await chat.sendMessage(userQueryParts);
        const response = await result.response;
        const text = response.text();
        
        res.json({ response: text });

    } catch (error) {
        console.error('Gemini API error:', error);
        res.status(500).json({ response: 'Sorry, I am unable to respond right now.' });
    }
});

app.get('/dashboard', (req, res) => {
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

app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
