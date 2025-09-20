// Import necessary modules
const express = require("express");
const bodyParser = require("body-parser");
const QRCode = require("qrcode");
const path = require("path");
const dotenv = require("dotenv");
const { OAuth2Client } = require("google-auth-library");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const multer = require("multer");
const cors = require("cors");
const mongoose = require("mongoose");
const { put } = require("@vercel/blob");

// Load environment variables
dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(cors());

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB connected successfully."))
    .catch(err => console.error("❌ MongoDB connection error:", err));

// --- Schemas ---
const donatorSchema = new mongoose.Schema({
    id: String,
    name: String,
    email: String,
    profilePic: String,
    registrationDate: { type: Date, default: Date.now }
});
const Donator = mongoose.model("Donator", donatorSchema);

const caseSchema = new mongoose.Schema({
    patient_name: String,
    medical_condition: String,
    description: String,
    requested_amount: Number,
    images: [String],
    status: { type: String, default: "Pending" },
    date_added: { type: Date, default: Date.now }
});
const Case = mongoose.model("Case", caseSchema);

const donationSchema = new mongoose.Schema({
    name: String,
    email: String,
    amount: Number,
    date: { type: Date, default: Date.now },
    status: { type: String, default: "Pending" },
    rejectionReason: String,
    transactionId: String,
});
const Donation = mongoose.model("Donation", donationSchema);

// --- Google AI Init ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- Multer (in-memory storage) ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- Redirect root ---
app.get("/", (req, res) => res.redirect("/dashboard"));

// --- Donation Route ---
app.post("/donate", async (req, res) => {
    const { amount, name, email } = req.body;
    const upiLink = `upi://pay?pa=${process.env.UPI_ID}&pn=${encodeURIComponent(name || "CareFund")}&am=${amount}&cu=INR`;

    try {
        const qrImage = await QRCode.toDataURL(upiLink);

        const newDonation = new Donation({ name, email, amount });
        await newDonation.save();

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Complete Your Donation</title>
            </head>
            <body>
                <div style="text-align:center;margin-top:50px">
                    <h1>Scan & Pay</h1>
                    <p>Amount: ₹${amount}</p>
                    <img src="${qrImage}" width="200" />
                    <br><br>
                    <a href="${upiLink}">Pay Now</a>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        console.error("❌ Error generating QR code:", err.message, err.stack);
        res.status(500).send("Error creating donation. Please try again.");
    }
});

// --- Google Register ---
app.post("/api/donater/google-register", async (req, res) => {
    const idToken = req.body.id_token;
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

    try {
        const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();

        let donator = await Donator.findOne({ email: payload.email });
        if (donator) {
            return res.status(200).json({ message: "Already registered", donator, redirect: "/user-dashboard.html" });
        }

        donator = new Donator({
            id: payload.sub,
            name: payload.name,
            email: payload.email,
            profilePic: payload.picture,
        });
        await donator.save();

        res.status(200).json({ message: "Registration successful", donator, redirect: "/user-dashboard.html" });
    } catch (error) {
        console.error("❌ Google login failed:", error.message, error.stack);
        res.status(401).json({ message: "Authentication failed" });
    }
});

// --- Admin Login ---
app.post("/api/admin/login", (req, res) => {
    const { username, password } = req.body;
    const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "carefund";
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "SJCHS@123";

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        res.status(200).json({ message: "Login successful", redirect: "/admin-dashboard.html" });
    } else {
        res.status(401).json({ message: "Invalid credentials" });
    }
});

// --- Approve Donation ---
app.post("/api/admin/approve-donation", async (req, res) => {
    const { id, transactionId } = req.body;
    try {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid donation ID" });
        }

        const updatedDonation = await Donation.findByIdAndUpdate(
            id,
            { status: "Approved", transactionId },
            { new: true }
        );

        if (!updatedDonation) return res.status(404).json({ message: "Donation not found" });
        res.status(200).json({ message: "Donation approved successfully" });
    } catch (error) {
        console.error("❌ Error approving donation:", error.message, error.stack);
        res.status(500).json({ message: "Error approving donation" });
    }
});

// --- Reject Donation ---
app.post("/api/admin/reject-donation", async (req, res) => {
    const { id, reason } = req.body;
    try {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid donation ID" });
        }

        const updatedDonation = await Donation.findByIdAndUpdate(
            id,
            { status: "Rejected", rejectionReason: reason },
            { new: true }
        );

        if (!updatedDonation) return res.status(404).json({ message: "Donation not found" });
        res.status(200).json({ message: "Donation rejected successfully" });
    } catch (error) {
        console.error("❌ Error rejecting donation:", error.message, error.stack);
        res.status(500).json({ message: "Error rejecting donation" });
    }
});

// --- Add / Get Cases ---
app.route("/api/admin/cases")
    .get(async (req, res) => {
        try {
            const cases = await Case.find().sort({ date_added: -1 });
            res.json(cases);
        } catch (error) {
            console.error("❌ Error fetching cases:", error.message, error.stack);
            res.status(500).json({ message: "Error fetching cases" });
        }
    })
    .post(upload.array("images", 5), async (req, res) => {
        try {
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ message: "No images uploaded" });
            }

            if (!process.env.BLOB_READ_WRITE_TOKEN) {
                return res.status(500).json({ message: "Blob storage token not configured" });
            }

            const uploadPromises = req.files.map(file =>
                put(file.originalname, file.buffer, { access: "public" })
            );
            const uploadedBlobs = await Promise.all(uploadPromises);
            const imageUrls = uploadedBlobs.map(blob => blob.url);

            const requestedAmount = Number(req.body.requestedAmount);
            if (isNaN(requestedAmount)) {
                return res.status(400).json({ message: "Invalid requested amount" });
            }

            const newCase = new Case({
                patient_name: req.body.patientName,
                medical_condition: req.body.medicalCondition,
                description: req.body.description,
                requested_amount: requestedAmount,
                images: imageUrls,
            });

            const savedCase = await newCase.save();
            res.status(201).json({ message: "Case added successfully", case: savedCase });
        } catch (error) {
            console.error("❌ Error adding case:", error.message, error.stack);
            res.status(500).json({ message: "Error adding case" });
        }
    });

// --- Other Routes (donators, public, stats etc.) remain same ---
// (keep your existing ones unchanged)

// --- 404 Fallback ---
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "dashboard.html")));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
