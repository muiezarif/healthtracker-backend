import express from "express"
import dotenv from "dotenv"
import mongoose from "mongoose"
import cookieParser from "cookie-parser"
import cors from "cors"
import bodyParser from "body-parser"
import authRoutes from './routes/auth.route.js';
import adminRoutes from './routes/admin.route.js';
import patientRoutes from './routes/patient.route.js';
import providerRoutes from './routes/provider.route.js';


const app = express();
dotenv.config();






// DB Connection
const db_connect = async () => {
    try {
        await mongoose.connect(process.env.MONGO_DB_URL)
        console.log("Connected to mongodb")
    } catch (error) {
        throw error
    }
}


// Middlewares
app.use(cors());
app.use(cookieParser())
app.use(express.json())
app.use(express.urlencoded({ extended: true }));


app.get("/", (req,res) => {
    res.send("First request")
})

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/provider', providerRoutes);

app.listen(process.env.PORT || 3030, function(){
    db_connect()
    console.log("Express server listening on port %d in %s mode", this.address().port, app.settings.env);
    
  });