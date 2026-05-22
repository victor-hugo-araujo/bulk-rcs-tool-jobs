import { useState, useCallback } from 'react'
import { parseCSVFile, validateContacts } from '../services/csvService'
import { CONTACT_STATUS } from '../utils/constants'

export const useContacts = () => {
  const [contacts, setContacts] = useState([])
  const [csvFile, setCsvFile] = useState(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)


  const handleFileUpload = useCallback(async (file) => {
    if (!file) return

    // Handle both File objects and FileList arrays
    const fileToProcess = file.length !== undefined ? file[0] : file

    if (!fileToProcess.name.toLowerCase().endsWith('.csv')) {
      setUploadError('Please upload a CSV file')
      return
    }

    setIsUploading(true)
    setUploadError(null)

    try {
      // The file is also streamed to the backend at send time; we parse a preview
      // in the browser so the UI can detect variable columns and show a sample.
      const parsedContacts = await parseCSVFile(fileToProcess)
      setContacts(parsedContacts)
      setCsvFile(fileToProcess)
    } catch (error) {
      setUploadError(error.message)
      console.error('CSV upload error:', error)
    } finally {
      setIsUploading(false)
    }
  }, [])


  const updateContactStatus = useCallback((phone, status) => {
    setContacts(prevContacts => 
      prevContacts.map(contact => 
        contact.phone === phone 
          ? { ...contact, status }
          : contact
      )
    )
  }, [])


  const updateContactsFromResults = useCallback((results) => {
    setContacts(prevContacts => {
      return prevContacts.map(contact => {
        // Check if this contact was successful
        const successResult = results.successful?.find(
          result => result.phone === contact.phone
        )
        if (successResult) {
          return { ...contact, status: CONTACT_STATUS.SENT }
        }
        
        // Check if this contact failed
        const failedResult = results.failed?.find(
          result => result.phone === contact.phone
        )
        if (failedResult) {
          return { ...contact, status: CONTACT_STATUS.FAILED }
        }
        
        return contact
      })
    })
  }, [])


  const clearContacts = useCallback(() => {
    setContacts([])
    setCsvFile(null)
    setUploadError(null)
  }, [])


  const getValidationSummary = useCallback(() => {
    return validateContacts(contacts)
  }, [contacts])

  const getContactsByStatus = useCallback((status) => {
    return contacts.filter(contact => contact.status === status)
  }, [contacts])

  return {
    contacts,
    csvFile,
    isUploading,
    uploadError,
    handleFileUpload,
    updateContactStatus,
    updateContactsFromResults,
    clearContacts,
    getValidationSummary,
    getContactsByStatus,
    setContacts
  }
}
