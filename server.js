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

// Load environment variables from .env file
dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(cors());

// --- FIX: Initialize Google Generative AI once at the start ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Set up Multer for file uploads
const upload = multer({ dest: 'public/uploads/' });

// Temporary in-memory databases
const donatorsDB = [];
const casesDB = [];
const donationsDB = [];

// Redirect the root URL to the dashboard
app.get("/", (req, res) => {
    res.redirect("/dashboard");
});
// Route to handle donation form submission and generate QR
app.post("/donate", async (req, res) => {
    const { amount, name, email } = req.body;
    const upiLink = `upi://pay?pa=${process.env.UPI_ID}&pn=${encodeURIComponent(
        name || "CareFund"
    )}&am=${amount}&cu=INR`;

    try {
        const qrImage = await QRCode.toDataURL(upiLink);
        // Simulate a successful payment and save the donation
        donationsDB.push({
            id: donationsDB.length + 1,
            name: name,
            email: email,
            amount: amount,
            date: new Date().toISOString(),
            status: 'Pending',
            rejectionReason: '', // Added field
            transactionId: ''    // Added field
        });

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

app.get('/api/admin/donations', (req, res) => {
    res.json(donationsDB);
});

// Updated endpoint for approving a donation
app.post('/api/admin/approve-donation', (req, res) => {
    const { id, transactionId } = req.body;
    const donation = donationsDB.find(d => d.id == id);
    if (donation) {
        donation.status = 'Approved';
        donation.transactionId = transactionId; // Set the transaction ID
        res.status(200).json({ message: 'Donation approved successfully.' });
    } else {
        res.status(404).json({ message: 'Donation not found.' });
    }
});

// Updated endpoint for rejecting a donation
app.post('/api/admin/reject-donation', (req, res) => {
    const { id, reason } = req.body;
    const donation = donationsDB.find(d => d.id == id);
    if (donation) {
        donation.status = 'Rejected';
        donation.rejectionReason = reason; // Set the rejection reason
        res.status(200).json({ message: 'Donation rejected successfully.' });
    } else {
        res.status(404).json({ message: 'Donation not found.' });
    }
});

app.route('/api/admin/cases')
    .get((req, res) => {
        res.json(casesDB);
    })
    .post(upload.array('images', 5), (req, res) => {
        const newCase = {
            id: casesDB.length + 1,
            patientName: req.body.patientName,
            medicalCondition: req.body.medicalCondition,
            description: req.body.description,
            requestedAmount: req.body.requestedAmount,
            images: req.files.map(file => `/uploads/${file.filename}`),
            status: 'Pending',
            dateAdded: new Date().toISOString()
        };
        casesDB.push(newCase);
        console.log('New case added:', newCase);
        res.status(201).json({ message: 'Case added successfully!', case: newCase });
    });

app.get('/api/public/cases', (req, res) => {
    res.json(casesDB);
});

// --- UPDATED API ENDPOINT ---
app.post('/api/my-donations', (req, res) => {
    const userEmail = req.body.email;
    // This line was changed to remove the status filter
    const myDonations = donationsDB.filter(d => d.email === userEmail);
    res.json(myDonations);
});

// --- FIX: Corrected AI Chatbot route ---
// This code is a direct replacement for your existing app.post('/api/chat', ...) route.
app.post('/api/chat', async (req, res) => {
    try {
        const { history } = req.body;
        
        // Ensure history is provided and is an array
        if (!Array.isArray(history) || history.length === 0) {
            return res.status(400).json({ response: 'Invalid request: Chat history is required and cannot be empty.' });
        }
        
        // --- IMPORTANT FIX START ---
        // Check if the first message in the history is from the model.
        // If it is, remove it to prevent the API error.
        // The API must always start a new chat with a 'user' role message.
        if (history[0].role === 'model') {
            history.shift(); 
        }
        // --- IMPORTANT FIX END ---

        // Start a new chat session with the corrected history
        const chat = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).startChat({
            history: history,
            generationConfig: {
                maxOutputTokens: 100,
            },
        });
        
        // Get the last message from the history to send
        // Note: You must send the entire 'parts' array, not just the text string.
        const userQueryParts = history[history.length - 1].parts;
        
        // Send the message and get a response from the AI
        const result = await chat.sendMessage(userQueryParts);
        const response = await result.response;
        const text = response.text();
        
        // Send the AI's response back to the client
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