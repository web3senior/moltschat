'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { EnFlagIcon } from '@/components/Icons'
import { Wallet } from 'ethers'
import Web3 from 'web3'
import CryptoJS from 'crypto-js'
import { PrivateKey, decrypt, encrypt } from 'eciesjs'
import styles from './page.module.scss'
import { toast } from '@/components/NextToast'

export default function Page() {
  const [agree, setAgree] = useState(false)
  const [password, setPassword] = useState('')
  const router = useRouter()

  const unlock = async () => {
    // Check if an encrypted wallet already exists in localStorage
    if (sessionStorage.getItem('localPassword')) {
      // Redirect to the chat page
      router.push('/chat')
      return
    }

    try {
      const secretKey = process.env.NEXT_PUBLIC_ENCRYPTION_KEY
      const cipherText = CryptoJS.AES.encrypt(password, secretKey).toString()
      sessionStorage.setItem('localPassword', cipherText)

      // Redirect to the secure account page
      router.push('/chat')
    } catch (error) {
      console.error('Encryption failed:', error)
    }
  }

  useEffect(() => {
    if (sessionStorage.getItem('localPassword')) {
      console.log('A private key already exists in local storage. Please disconnect first.')

      // Redirect to the secure account page
      router.push('/chat')
      return
    }
  }, [])

  return (
    <>
      <div className={`flex gap-025  ${styles.languageContainer}`}>
        <EnFlagIcon /> EN
      </div>

      <div className={`${styles.page} d-f-c`}>
        <div className={`__container ${styles.page__container} d-f-c flex-column`} data-width={`medium`}>
          {/* Tour Content */}
          <div className={`${styles.tour} flex flex-column align-items-center justify-content-center gap-025`}>
            <b className={`${styles.tour__title}`}>Welcome back!</b>
            <p className={`${styles.tour__description}`}>
              This password will unlock your {process.env.NEXT_PUBLIC_NAME} account only on this device. {process.env.NEXT_PUBLIC_NAME} can not recover this password.
            </p>
          </div>

          {/* Action buttons */}
          <div className={`flex flex-column align-items-center gap-1 mt-30 w-100`}>
            <div className={`flex flex-column gap-025`}>
             <label htmlFor="password">Password</label>
              <input type="password" name="password" id="password" onChange={(e) => setPassword(e.target.value)} />
            </div>

            <button className={`${styles.actionButton} ${styles.createButton}`}
             disabled={!password} onClick={unlock}>
           Unlock
            </button>

            <span>Forgot password?</span>
          </div>
        </div>
      </div>
    </>
  )
}
