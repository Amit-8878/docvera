const User = require('../models/User')
const bcrypt = require('bcryptjs')

let tempAdminSeeded = false

// ✅ PURE FUNCTION (NO next)
async function seedTempAdminUser() {
  try {
    const email = 'admin@gmail.com'
    const password = 'admin123'
    const name = 'Admin'

    // Prevent undefined/empty required values before any save/create call.
    if (!email || !password || !name) return false

    const hashed = await bcrypt.hash(password, 10)

    let user = await User.findOne({ email })

    if (!user) {
      await User.create({
        name,
        email,
        password: hashed,
        role: 'admin'
      })
      console.log('[tempAdmin] Created admin:', email)
    } else {
      user.name = user.name || name
      user.password = hashed
      user.role = 'admin'
      await user.save()
      console.log('[tempAdmin] Refreshed password & admin role:', email)
    }

    return true
  } catch (err) {
    console.error('[seedTempAdminUser]', err)
    return false
  }
}

// ✅ MIDDLEWARE ONLY HERE uses next()
async function ensureTempAdminUser(req, res, next) {
  try {
    if (tempAdminSeeded) return next()

    await seedTempAdminUser()

    tempAdminSeeded = true
    return next()
  } catch (err) {
    console.error('[ensureTempAdminUser]', err)
    return next()
  }
}

module.exports = { ensureTempAdminUser }