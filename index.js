const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken')
const app = express()
require('dotenv').config()
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)

const port = process.env.PORT || 5000;


app.use(cors())
app.use(express.json())



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.g1uks.mongodb.net/?retryWrites=true&w=majority`;
console.log(uri)
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

function verifyJWT(req, res, next) {
    console.log(req.headers.authorization)
    const authHeader = req.headers.authorization
    if (!authHeader) {
        return res.status(401).send('unauthorized access')
    }
    const token = authHeader.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded
        next()
    })

}

async function run() {
    try {
        const servicesCollection = client.db('jerinsParlour').collection('services')
        const bookingsCollection = client.db('jerinsParlour').collection('bookings')
        const usersCollection = client.db('jerinsParlour').collection('users')
        const addServicesCollection = client.db('jerinsParlour').collection('addservice')
        const reviewCollection = client.db('jerinsParlour').collection('review')
        const paymentsCollection = client.db('jerinsParlour').collection('payment')

        const verifyAdmin = async (req, res, next) => {
            console.log('insight verifyAdmin', req.decoded.email)
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail }
            const user = await usersCollection.findOne(query)
            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        app.get('/services', async (req, res) => {
            const date = req.query.date;

            const query = {}
            const services = await servicesCollection.find(query).toArray()
            const bookingQuery = { selectedDate: date }
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray()
            services.forEach(service => {
                const serviceBooked = alreadyBooked.filter(booked => booked.treatment === service.name)
                const bookedSlot = serviceBooked.map(book => book.slot)
                const remainingSlot = service.slots.filter(slot => !bookedSlot.includes(slot))
                service.slots = remainingSlot
            })
            res.send(services)
        })

        app.get('/bookings', verifyJWT, async (req, res) => {
            const email = req.query.email;
            console.log(req.headers.authorization)
            const decodedEmail = req.decoded.email
            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            const query = {
                email: email
            }
            const result = await bookingsCollection.find(query).toArray()
            res.send(result)
        })
        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const booking = await bookingsCollection.findOne(query)
            res.send(booking)
        })

        app.post('/bookings', async (req, res) => {
            const booking = req.body
            const query = {
                selectedDate: booking.selectedDate,
                email: booking.email,
                treatment: booking.treatment
            }
            const alreadyBooked = await bookingsCollection.find(query).toArray()
            if (alreadyBooked.length) {
                const message = `You already have a booking on ${booking.selectedDate}`
                return res.send({ acknowledged: false, message })
            }
            const result = await bookingsCollection.insertOne(booking)
            res.send(result)
        })

        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment)
            const id = payment.bookingId
            const filter = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc)
            res.send(result)
        })
        app.get('/jwt', async (req, res) => {
            const email = req.query.email
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
                return res.send({ accessToken: token })
            }
            res.status(403).send({ accessToken: ' ' })
        })

        app.get('/users', async (req, res) => {
            const query = {}
            const users = await usersCollection.find(query).toArray()
            res.send(users)
        })

        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query)
            res.send({ isAdmin: user?.role === 'admin' })
        })

        app.delete('/users/admin/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const result = await usersCollection.deleteOne(filter)
            res.send(result)
        })

        app.post('/users', async (req, res) => {
            const user = req.body
            const result = await usersCollection.insertOne(user)
            res.send(result)

        })

        app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const filter = { _id: new ObjectId(id) }
            const options = { upsert: true }
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, options)
            res.send(result)
        })

        app.get('/service', verifyJWT, verifyAdmin, async (req, res) => {
            const query = {}
            const result = await addServicesCollection.find(query).toArray()
            res.send(result)

        })


        app.delete('/service/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const result = await addServicesCollection.deleteOne(filter)
            res.send(result)
        })

        app.post('/service', verifyJWT, verifyAdmin, async (req, res) => {
            const service = req.body
            const result = await addServicesCollection.insertOne(service)
            res.send(result)
        })

        app.get('/review', verifyJWT, async (req, res) => {
            const query = {}
            const result = await reviewCollection.find(query).toArray()
            res.send(result)

        })

        app.post('/review', verifyJWT, async (req, res) => {
            const review = req.body
            const result = await reviewCollection.insertOne(review)
            res.send(result)
        })

    } finally {

    }
}
run().catch(console.log)

app.get('/', (req, res) => {
    res.send('jerins parlour server is running')
})

app.listen(port, () => {
    console.log(`server is running in ${port}`)
})






