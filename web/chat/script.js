let serverOnline = false;
let personas = JSON.parse(localStorage.getItem('personas')) || [];
// Create default Assistant persona if no personas exist
if (personas.length === 0) {
    personas = [{
        id: Date.now(),
        name: "Assistant",
        model: "", // Will be set to first available model
        temperature: 0.7,
        systemPrompt: "You are a helpful AI assistant. You provide clear, accurate, and well-reasoned responses while being direct and concise.",
        avatar: "AI"
    }];
    localStorage.setItem('personas', JSON.stringify(personas));
}
let selectedPersonas = [];
let remainingPersonas = [];
let autoContinue = false;
let selectedImage = null;
let backendUrl = localStorage.getItem('ollamaBackendUrl') || 'http://localhost:11434';
let summarySettings = JSON.parse(localStorage.getItem('summarySettings')) || {
    model: '',
    windowSize: 5
};
let summaryWorker = null;
let currentSummary = '';
let chatHistory = [];
let conversations = JSON.parse(localStorage.getItem('conversations')) || [];
let currentConversationId = null;
const SUMMARY_THRESHOLD = 5; // Generate summary every X messages

function startNewChat() {
    // Clear current state
    currentConversationId = Date.now();
    chatHistory = [];
    
    // Create new conversation
    const conversation = {
        id: currentConversationId,
        title: 'New Chat',
        messages: [],
        created: Date.now(),
        hasGeneratedTitle: false
    };
    
    // Add to beginning of conversations list
    conversations = [conversation, ...conversations];
    localStorage.setItem('conversations', JSON.stringify(conversations));
    
    // Update UI
    updateConversationsList();
    loadConversation(currentConversationId);
    
    // Clear response area and prompt
    const responseArea = document.getElementById('response');
    responseArea.innerHTML = '';
    document.getElementById('prompt').value = '';
}

function loadConversation(id) {
    // Find conversation
    const conversation = conversations.find(c => c.id === id);
    if (!conversation) return;
    
    // Update state
    currentConversationId = id;
    chatHistory = [...conversation.messages]; // Make a copy of messages
    
    // Clear and rebuild UI
    const responseArea = document.getElementById('response');
    responseArea.innerHTML = '';
    
    // Add messages to UI
    chatHistory.forEach(msg => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${msg.role === 'Assistant' ? 'ai' : 'user'}-message`;
        if (msg.role === 'Assistant') {
            messageDiv.innerHTML = `
                <div class="ai-avatar">${msg.avatar || 'AI'}</div>
                ${marked.parse(msg.content)}
            `;
        } else {
            messageDiv.innerHTML = msg.content;
        }
        responseArea.appendChild(messageDiv);
    });
    
    // Scroll to latest message if any exist
    if (chatHistory.length > 0) {
        responseArea.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    // Update conversation list to reflect new active state
    updateConversationsList();
}

let pendingDeleteId = null;

function deleteConversation(id, event) {
    // Ensure the event doesn't bubble up
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    
    pendingDeleteId = id;
    
    const modal = document.getElementById('confirmModal');
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('show'));
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 300);
    pendingDeleteId = null;
}

function exportConversation() {
    if (pendingDeleteId === null) return;
    
    const conversation = conversations.find(conv => conv.id === pendingDeleteId);
    if (!conversation) return;
    
    // Create export data
    const exportData = {
        title: conversation.title,
        date: new Date(conversation.id).toISOString(),
        messages: conversation.messages
    };
    
    // Convert to JSON string
    const jsonStr = JSON.stringify(exportData, null, 2);
    
    // Create blob and download
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${conversation.title.toLowerCase().replace(/\s+/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function confirmDelete() {
    if (pendingDeleteId === null) return;
    
    conversations = conversations.filter(conv => conv.id !== pendingDeleteId);
    localStorage.setItem('conversations', JSON.stringify(conversations));
    
    // If we deleted the current conversation, load the most recent one or start new
    if (pendingDeleteId === currentConversationId) {
        if (conversations.length > 0) {
            loadConversation(conversations[0].id);
        } else {
            startNewChat();
        }
    }
    
    // Always update the conversations list
    updateConversationsList();
    closeConfirmModal();
}

function updateConversationsList() {
    const list = document.getElementById('conversationsList');
    const sortedConversations = conversations.sort((a, b) => b.id - a.id);
    
    // Always clear and rebuild the list
    list.innerHTML = '';
    
    sortedConversations.forEach(conv => {
        const item = document.createElement('div');
        item.className = `conversation-item ${conv.id === currentConversationId ? 'active' : ''}`;
        item.onclick = () => loadConversation(conv.id);
        
        item.innerHTML = `
            <div class="conversation-title">${conv.title}</div>
            <div class="conversation-date">${new Date(conv.id).toLocaleDateString()}</div>
            <button class="delete-conversation" onclick="event.stopPropagation(); deleteConversation(${conv.id}, event)">
                <span class="material-icons">delete</span>
            </button>
        `;
        
        list.appendChild(item);
    });
}

async function generateTitle(firstMessage) {
    console.log('generateTitle called with:', {
        message: firstMessage,
        backendUrl: backendUrl,
        currentConversationId: currentConversationId
    });
    
    try {
        // First check if llama2 model is available
        console.log('Fetching available models');
        const response = await fetch(`${backendUrl}/api/tags`);
        const data = await response.json();
        console.log('Available models:', data.models);
        
        const hasLlama2 = data.models.some(model => model.name.startsWith('llama2'));
        const modelToUse = hasLlama2 ? 'llama2' : data.models[0]?.name;
        console.log('Selected model for title generation:', modelToUse);
        
        if (!modelToUse) {
            console.error('No models available for title generation');
            return 'New Chat';
        }

        console.log('Sending title generation request');
        const generateResponse = await fetch(`${backendUrl}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: modelToUse,
                prompt: `Create a short title (max 6 words) for a conversation that starts with this message: "${firstMessage}"\nTitle: `,
                temperature: 0.7,
                stream: false
            })
        });

        if (!generateResponse.ok) {
            throw new Error(`HTTP error! status: ${generateResponse.status}`);
        }

        const result = await generateResponse.json();
        console.log('Generated title result:', result);
        const title = result.response.trim() || 'New Chat';
        console.log('Final processed title:', title);
        return title;
    } catch (error) {
        console.error('Error generating title:', error);
        return 'New Conversation';
    }
}

// Auto-resize textarea
const textarea = document.getElementById('prompt');
textarea.addEventListener('input', function() {
    // Reset height to auto to get the correct scrollHeight
    this.style.height = 'auto';
    // Set new height based on content, max 200px
    const newHeight = Math.min(this.scrollHeight, 200);
    this.style.height = newHeight + 'px';
    // Only show scrollbar if content exceeds max height
    this.style.overflowY = newHeight === 200 ? 'auto' : 'hidden';
});

// Reset height when cleared
textarea.addEventListener('focus', function() {
    if (!this.value) {
        this.style.height = '54px';
        this.style.overflowY = 'hidden';
    }
});

// Initialize temperature controls when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    const temperatureSlider = document.getElementById('personaTemperature');
    const temperatureValue = document.getElementById('personaTempValue');
    
    if (temperatureSlider && temperatureValue) {
        temperatureSlider.addEventListener('input', function() {
            updateTemperatureValue(this.value);
        });

        // Add click handler to make temperature value editable
        temperatureValue.addEventListener('click', function() {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '2';
    input.step = '0.1';
    input.value = this.textContent;
    input.style.width = '50px';
    
    input.addEventListener('blur', function() {
        const newValue = Math.min(Math.max(parseFloat(this.value) || 0, 0), 2);
        updateTemperatureValue(newValue);
        temperatureSlider.value = newValue;
    });

    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            this.blur();
        }
    });

    this.textContent = '';
    this.appendChild(input);
    input.focus();
        });
    }
});

function updateTemperatureValue(value) {
    const formattedValue = parseFloat(value).toFixed(1);
    temperatureValue.textContent = formattedValue;
}

async function checkServerStatus() {
    const statusIndicator = document.getElementById('serverStatus');
    const statusText = document.getElementById('serverStatusText');
    const generateButton = document.getElementById('generate');

    try {
        const response = await fetch(`${backendUrl}/api/tags`);
        if (response.ok) {
            statusIndicator.className = 'status-indicator status-online';
            statusText.textContent = 'Server Online';
            generateButton.disabled = false;
            serverOnline = true;
            return true;
        }
    } catch (error) {
        console.error('Server check failed:', error);
    }

    statusIndicator.className = 'status-indicator status-offline';
    statusText.textContent = 'Server Offline';
    generateButton.disabled = true;
    serverOnline = false;
    return false;
}

async function fetchModels() {
    const isOnline = await checkServerStatus();
    const modelSelect = document.getElementById('modelList');
    const personaModelSelect = document.getElementById('personaModel');
    const modelGrid = document.getElementById('modelGrid');
    
    if (!isOnline) {
        const offlineOption = '<option value="">Server offline</option>';
        if (modelSelect) modelSelect.innerHTML = offlineOption;
        if (personaModelSelect) personaModelSelect.innerHTML = offlineOption;
        if (modelGrid) modelGrid.innerHTML = '<div>Server offline</div>';
        return;
    }

    try {
        const response = await fetch(`${backendUrl}/api/tags`);
        const data = await response.json();
        
        // Update default Assistant's model if needed
        if (personas.length === 1 && personas[0].name === "Assistant" && !personas[0].model && data.models.length > 0) {
            personas[0].model = data.models[0].name;
            localStorage.setItem('personas', JSON.stringify(personas));
            updatePersonasList();
        }

        // Create options HTML once
        const optionsHTML = data.models.map(model => 
            `<option value="${model.name}">${model.name}</option>`
        ).join('');
        
        // Update all dropdown lists
        if (modelSelect) modelSelect.innerHTML = optionsHTML;
        if (personaModelSelect) personaModelSelect.innerHTML = optionsHTML;

        // Update model grid in settings
        const modelGrid = document.getElementById('modelGrid');
        if (modelGrid) {
            modelGrid.innerHTML = '';
            data.models.forEach(model => {
                const card = document.createElement('div');
                card.className = 'model-card';
                card.innerHTML = `
                    <h3>${model.name}</h3>
                    <div class="model-meta">
                        <span class="tag">Size: ${formatSize(model.size)}</span>
                        <span class="tag">Modified: ${formatDate(model.modified_at)}</span>
                    </div>
                    <div class="model-actions">
                        <button class="btn btn-danger" onclick="deleteModel('${model.name}')">
                            Delete
                        </button>
                    </div>
                `;
                modelGrid.appendChild(card);
            });
        }
    } catch (error) {
        console.error('Error fetching models:', error);
        document.getElementById('modelList').innerHTML = 
            '<option value="">Error loading models</option>';
        const modelGrid = document.getElementById('modelGrid');
        if (modelGrid) {
            modelGrid.innerHTML = '<div>Error loading models</div>';
        }
    }
}

async function generateResponse(isAutoResponse = false) {
    if (!serverOnline) {
        showAlert('Server is offline. Please check your Ollama server.');
        return;
    }

    // Prevent multiple simultaneous responses
    const button = document.getElementById('generate');
    if (button.disabled) {
        return;
    }
    
    // Check if we need to update the summary
    const conversation = conversations.find(c => c.id === currentConversationId);
    if (conversation && conversation.messages.length % SUMMARY_THRESHOLD === 0) {
        // Run summary generation in background
        generateSummary(conversation.messages, false).catch(error => {
            console.error('Background summary generation failed:', error);
        });
    }

    // Handle conversation flow
    if (!isAutoResponse) {
        // Fresh start with human input
        remainingPersonas = [...selectedPersonas].sort(() => Math.random() - 0.5);
    } else if (autoContinue) {
        // Auto-continue mode - use next persona in the shuffled list
        document.getElementById('prompt').value = "";
        // If we've used all personas, reshuffle the list
        if (remainingPersonas.length === 0) {
            remainingPersonas = [...selectedPersonas].sort(() => Math.random() - 0.5);
        }
    }

    if (selectedPersonas.length === 0) {
        showAlert('Please select at least one persona');
        return;
    }

    const promptInput = document.getElementById('prompt');
    const prompt = promptInput.value.trim();
    
    // Only require prompt for manual responses
    if (!isAutoResponse && !prompt) {
        showAlert('Please enter a prompt');
        return;
    }

    const responseDiv = document.getElementById('response');
    
    // Only add user message if this is not an auto-response
    if (!isAutoResponse) {
        const userMessage = document.createElement('div');
        userMessage.className = 'message user-message';
        userMessage.textContent = prompt;
        responseDiv.appendChild(userMessage);
        userMessage.scrollIntoView({ behavior: 'smooth', block: 'end' });
        
        // Add to chat history
        chatHistory.push({ role: 'Human', content: prompt });
    }

    // Clear input field and reset height
    promptInput.value = '';
    promptInput.style.height = 'auto';

    // Disable generate button during responses
    button.disabled = true;

    try {
        // Initialize or reset remainingPersonas
        if (remainingPersonas.length === 0) {
            remainingPersonas = [...selectedPersonas]
                .sort(() => Math.random() - 0.5);
        }

        // Get responses from all selected personas
        for (const currentPersona of remainingPersonas) {
            console.log(`${currentPersona.name} is responding...`);

            // Add loading animation for this persona
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'loading-animation';
            loadingDiv.innerHTML = `
                <span>${currentPersona.name} is responding...</span>
                <div class="dots">
                    <div class="dot"></div>
                    <div class="dot"></div>
                    <div class="dot"></div>
                </div>
            `;
            responseDiv.appendChild(loadingDiv);

            // Create AI response div
            const aiResponse = document.createElement('div');
            aiResponse.className = 'message ai-message';

            try {
                // Format chat history for context
                const formattedHistory = chatHistory.map(msg => 
                    `${msg.role}: ${msg.content}`
                ).join('\n');

                // Combine history with current prompt
                const systemPrompt = currentPersona.systemPrompt ? 
                    `System: ${currentPersona.systemPrompt}\n\n` : '';
                const fullPrompt = systemPrompt + formattedHistory;

                const requestBody = {
                    model: currentPersona.model,
                    prompt: fullPrompt,
                    temperature: currentPersona.temperature,
                    stream: true
                };

                // Add image if present
                if (selectedImage) {
                    requestBody.images = [selectedImage];
                }

                const response = await fetch(`${backendUrl}/api/generate`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const reader = response.body.getReader();
                let fullResponse = '';

                while (true) {
                    const {value, done} = await reader.read();
                    if (done) break;
                    
                    const chunk = new TextDecoder().decode(value);
                    const lines = chunk.split('\n');
                    
                    for (const line of lines) {
                        if (line.trim()) {
                            try {
                                const jsonResponse = JSON.parse(line);
                                if (jsonResponse.response) {
                                    // On first response, remove loading and add AI message div
                                    if (!fullResponse) {
                                        loadingDiv.remove();
                                        responseDiv.appendChild(aiResponse);
                                    }
                                    fullResponse += jsonResponse.response;
                                    aiResponse.innerHTML = `
                                        <div class="ai-avatar">${currentPersona.avatar}</div>
                                        <div class="message-content">
                                            ${marked.parse(fullResponse)}
                                            <button class="copy-hover-icon" onclick="copyToClipboard(this, \`${fullResponse.replace(/`/g, '\\`')}\`)">
                                                <span class="material-icons">content_copy</span>
                                            </button>
                                        </div>
                                    `;
                                    aiResponse.scrollIntoView({ behavior: 'smooth', block: 'end' });
                                }
                            } catch (e) {
                                console.error('Error parsing JSON:', e);
                            }
                        }
                    }
                }

                // Add to chat history
                chatHistory.push({ 
                    role: 'Assistant', 
                    content: fullResponse,
                    avatar: currentPersona.avatar 
                });

            } catch (error) {
                console.error('Error:', error);
                loadingDiv.remove();
                const errorDiv = document.createElement('div');
                errorDiv.className = 'message system-message';
                errorDiv.textContent = `Error (${currentPersona.name}): ${error.message}`;
                responseDiv.appendChild(errorDiv);
            }
        }

        // Handle conversation flow after responses
        if (autoContinue) {
            // Add a small delay before continuing to prevent UI lock
            setTimeout(() => {
                if (autoContinue) { // Verify auto-continue is still enabled
                    // Reset remainingPersonas if empty to start a new round
                    if (remainingPersonas.length === 0) {
                        remainingPersonas = [...selectedPersonas]
                            .sort(() => Math.random() - 0.5);
                    }
                    generateResponse(true);
                }
            }, 1000); // 1 second delay
        }

        // Update conversation
        const conversation = conversations.find(c => c.id === currentConversationId);
        if (conversation) {
            conversation.messages = [...chatHistory];
            
            // Only generate title once after the first message
            console.log('Checking title generation conditions:', {
                chatHistoryLength: chatHistory.length,
                hasGeneratedTitle: conversation.hasGeneratedTitle,
                conversationId: currentConversationId
            });
            
            if (!conversation.hasGeneratedTitle && chatHistory.length > 0) {
                // Mark as generated immediately to prevent multiple attempts
                conversation.hasGeneratedTitle = true;
                localStorage.setItem('conversations', JSON.stringify(conversations));
                console.log('Title generation conditions met');
                conversation.title = 'New Chat'; // Set temporary title
                
                // Generate title asynchronously without blocking
                console.log('Starting title generation for conversation:', {
                    id: currentConversationId,
                    firstMessage: chatHistory[0].content
                });
                
                generateTitle(chatHistory[0].content)
                    .then(newTitle => {
                        console.log('Generated title:', newTitle);
                        // Find and update the conversation in the global array
                        const index = conversations.findIndex(c => c.id === currentConversationId);
                        console.log('Found conversation at index:', index);
                        if (index !== -1) {
                            conversations[index].title = newTitle;
                            conversations[index].hasGeneratedTitle = true;
                            console.log('Updated conversation:', conversations[index]);
                            // Ensure changes are saved
                            localStorage.setItem('conversations', JSON.stringify(conversations));
                            console.log('Saved to localStorage');
                            // Force UI update
                            updateConversationsList();
                            console.log('Updated UI');
                        } else {
                            console.error('Conversation not found:', currentConversationId);
                        }
                    })
                    .catch(error => {
                        console.error('Error generating title:', error);
                        // Keep 'New Chat' title if generation fails
                    });
            }
            
            // Always save the conversation immediately
            localStorage.setItem('conversations', JSON.stringify(conversations));
            updateConversationsList();
        }

    } catch (error) {
        console.error('Error:', error);
        const errorDiv = document.createElement('div');
        errorDiv.className = 'message system-message';
        errorDiv.textContent = 'Error generating responses: ' + error.message;
        responseDiv.appendChild(errorDiv);
    } finally {
        button.disabled = false;
        selectedImage = null;
        document.getElementById('imagePreview').innerHTML = '';
    }

    // Ensure we have a valid conversation
    if (!currentConversationId || !conversations.find(c => c.id === currentConversationId)) {
        startNewChat();
    }
}

// Enter key to submit
textarea.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        generateResponse();
    }
});

setInterval(checkServerStatus, 5000);
fetchModels();

// Add this near the top of the file
function initTheme() {
    const theme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    
    // Set initial theme icon
    const themeIcon = document.querySelector('.theme-toggle .material-icons');
    themeIcon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Update theme icon
    const themeIcon = document.querySelector('.theme-toggle .material-icons');
    themeIcon.textContent = newTheme === 'dark' ? 'light_mode' : 'dark_mode';
}

// Add this to your initialization code
document.getElementById('darkModeToggle').addEventListener('click', toggleTheme);
initTheme();

// Add these functions to your existing script.js
async function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('show'));
    document.getElementById('backendUrl').value = backendUrl;
    
    // Fetch and populate models
    try {
        const response = await fetch(`${backendUrl}/api/tags`);
        const data = await response.json();
        
        // Update model grid in settings
        const modelGrid = document.getElementById('modelGrid');
        if (modelGrid) {
            modelGrid.innerHTML = '';
            data.models.forEach(model => {
                const card = document.createElement('div');
                card.className = 'model-card';
                card.innerHTML = `
                    <h3>${model.name}</h3>
                    <div class="model-meta">
                        <span class="tag">Size: ${formatSize(model.size)}</span>
                        <span class="tag">Modified: ${formatDate(model.modified_at)}</span>
                    </div>
                    <div class="model-actions">
                        <button class="btn btn-danger" onclick="deleteModel('${model.name}')">
                            Delete
                        </button>
                    </div>
                `;
                modelGrid.appendChild(card);
            });
        }
    } catch (error) {
        console.error('Error fetching models:', error);
        const modelGrid = document.getElementById('modelGrid');
        if (modelGrid) {
            modelGrid.innerHTML = '<div>Error loading models</div>';
        }
    }
}

function saveBackendUrl() {
    const urlInput = document.getElementById('backendUrl');
    const newUrl = urlInput.value.trim();
    
    if (!newUrl) {
        showAlert('Please enter a valid URL');
        return;
    }
    
    // Basic URL validation
    try {
        new URL(newUrl);
    } catch (e) {
        showAlert('Please enter a valid URL (e.g., http://localhost:11434)');
        return;
    }
    
    backendUrl = newUrl;
    localStorage.setItem('ollamaBackendUrl', newUrl);
    checkServerStatus(); // Check connection to new backend
    showAlert('Backend URL updated successfully');
}

function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 300);
}

// Initialize modal event listeners
function initModalListeners() {
    const settingsBtn = document.getElementById('settingsButton');
    const closeBtn = document.querySelector('.close-button');
    const tabButtons = document.querySelectorAll('.tab-button');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => 
                content.classList.remove('active'));
            
            // Add active class to clicked button and corresponding content
            button.classList.add('active');
            document.getElementById(`${button.dataset.tab}Tab`).classList.add('active');
        });
    });
    
    const handleSettingsClick = () => openSettingsModal();
    const handleCloseClick = () => closeSettingsModal();
    const handleOutsideClick = (event) => {
        const modal = document.getElementById('settingsModal');
        if (event.target === modal) {
            closeSettingsModal();
        }
    };
    
    settingsBtn.addEventListener('click', handleSettingsClick);
    closeBtn.addEventListener('click', handleCloseClick);
    window.addEventListener('click', handleOutsideClick);
}

// Initialize modal listeners
initModalListeners();

// Add model change handler after DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    const modelSelect = document.getElementById('modelList');
    if (modelSelect) {
        modelSelect.addEventListener('change', handleModelChange);
        handleModelChange();
    }
});

// Remove old event listener
window.removeEventListener('click', (event) => {
    const modal = document.getElementById('settingsModal');
    if (event.target === modal) {
        closeSettingsModal();
    }
});

// Add the model management functions from settings.html
function formatSize(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString();
}

async function deleteModel(modelName) {
    if (!confirm(`Are you sure you want to delete ${modelName}?`)) {
        return;
    }

    try {
        const response = await fetch(`${backendUrl}/api/delete`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: modelName })
        });

        if (response.ok) {
            fetchModels();
        } else {
            throw new Error('Failed to delete model');
        }
    } catch (error) {
        console.error('Error deleting model:', error);
        showAlert('Error deleting model: ' + error.message);
    }
}

async function pullModel() {
    // Copy the pullModel function from settings.html
    // It's the same implementation as shown in the settings file
}

function setupImageUpload() {
    const imageUploadBtn = document.getElementById('imageUpload');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // Set initial visibility to none
    imageUploadBtn.style.display = 'none';

    imageUploadBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', handleImageUpload);
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            selectedImage = e.target.result;
            displayImagePreview(selectedImage);
        };
        reader.readAsDataURL(file);
    }
}

function displayImagePreview(imageData) {
    const previewArea = document.getElementById('imagePreview');
    previewArea.innerHTML = '';

    const previewContainer = document.createElement('div');
    previewContainer.className = 'preview-container';

    const img = document.createElement('img');
    img.src = imageData;
    img.className = 'preview-image';

    const removeButton = document.createElement('button');
    removeButton.className = 'remove-image';
    removeButton.innerHTML = '×';
    removeButton.onclick = () => {
        selectedImage = null;
        previewArea.innerHTML = '';
    };

    previewContainer.appendChild(img);
    previewContainer.appendChild(removeButton);
    previewArea.appendChild(previewContainer);
}

// Add this to your initialization code
setupImageUpload();

// Sidebar toggle functionality
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    const toggleButton = document.getElementById('sidebarToggle');
    
    const isHidden = sidebar.classList.toggle('hidden');
    mainContent.classList.toggle('full-width');
    toggleButton.classList.toggle('active', !isHidden);
}

document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);

// Persona management functions
let editingPersonaId = null;

async function openPersonaModal(personaId = null) {
    const modal = document.getElementById('personaModal');
    const modelSelect = document.getElementById('personaModel');
    
    if (modal) {
        modal.style.display = 'flex';
        requestAnimationFrame(() => modal.classList.add('show'));
    }

    try {
        // Show loading state
        if (modelSelect) {
            modelSelect.innerHTML = '<option value="">Loading models...</option>';
        }
        
        // Fetch models
        await fetchModels();
        
        // Update model select with fetched models
        const response = await fetch(`${backendUrl}/api/tags`);
        const data = await response.json();
        
        if (modelSelect) {
            modelSelect.innerHTML = data.models.map(model => 
                `<option value="${model.name}">${model.name}</option>`
            ).join('');
            
            // Set first model as default for new personas
            if (!personaId && modelSelect.options.length > 0) {
                modelSelect.value = modelSelect.options[0].value;
            }
        }
        
        // If editing existing persona
        if (personaId) {
            editingPersonaId = personaId;
            const persona = personas.find(p => p.id === personaId);
            if (persona) {
                document.getElementById('personaName').value = persona.name;
                document.getElementById('personaModel').value = persona.model;
                document.getElementById('personaTemperature').value = persona.temperature;
                document.getElementById('personaTempValue').textContent = persona.temperature.toFixed(1);
                document.getElementById('personaPrompt').value = persona.systemPrompt || '';
            }
        } else {
            editingPersonaId = null;
            document.getElementById('personaName').value = '';
            document.getElementById('personaModel').value = '';
            document.getElementById('personaTemperature').value = 0.7;
            document.getElementById('personaTempValue').textContent = '0.7';
            document.getElementById('personaPrompt').value = '';
        }
    } catch (error) {
        console.error('Error loading persona:', error);
        showAlert('Error loading persona: ' + error.message);
    }
}

function editPersona(personaId) {
    openPersonaModal(personaId);
}

function closePersonaModal() {
    const modal = document.getElementById('personaModal');
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 300);
}

function savePersona() {
    const name = document.getElementById('personaName').value.trim();
    const model = document.getElementById('personaModel').value;
    const temperature = parseFloat(document.getElementById('personaTemperature').value);
    const systemPrompt = document.getElementById('personaPrompt').value.trim();

    if (!name || !model) {
        showAlert('Please fill in all required fields');
        return;
    }

    if (editingPersonaId) {
        // Update existing persona
        const index = personas.findIndex(p => p.id === editingPersonaId);
        if (index !== -1) {
            personas[index] = {
                ...personas[index],
                name,
                model,
                temperature,
                systemPrompt,
                avatar: name.substring(0, 2).toUpperCase()
            };
        }
    } else {
        // Create new persona
        const persona = {
            id: Date.now(),
            name,
            model,
            temperature,
            systemPrompt,
            avatar: name.substring(0, 2).toUpperCase()
        };
        personas.push(persona);
    }
    localStorage.setItem('personas', JSON.stringify(personas));
    updatePersonasList();
    closePersonaModal();
}

function updatePersonasList() {
    const list = document.getElementById('personasList');
    list.innerHTML = '';

    personas.forEach(persona => {
        const card = document.createElement('div');
        card.className = `persona-card ${selectedPersonas.some(p => p.id === persona.id) ? 'active' : ''}`;
        card.onclick = () => selectPersona(persona);

        card.innerHTML = `
            <div class="persona-avatar">${persona.avatar}</div>
            <div class="persona-name">${persona.name}</div>
            <div class="persona-model">${persona.model}</div>
            <div class="persona-actions">
                <button class="edit-persona" onclick="event.stopPropagation(); editPersona(${persona.id})">
                    <span class="material-icons">edit</span>
                </button>
            </div>
        `;

        list.appendChild(card);
    });
}

function selectPersona(persona) {
    const index = selectedPersonas.findIndex(p => p.id === persona.id);
    if (index === -1) {
        selectedPersonas.push(persona);
    } else {
        selectedPersonas.splice(index, 1);
    }
    updatePersonasList();
}

function toggleRightSidebar() {
    const sidebar = document.querySelector('.right-sidebar');
    const mainContent = document.querySelector('.main-content');
    const toggleButton = document.getElementById('rightSidebarToggle');
    
    const isHidden = sidebar.classList.toggle('hidden');
    mainContent.classList.toggle('right-full-width');
    toggleButton.classList.toggle('active', !isHidden);
}

// Initialize conversation interface
conversations = JSON.parse(localStorage.getItem('conversations')) || [];

// Clean up empty conversations
conversations = conversations.filter(conv => conv.messages.length > 0 || conv.id === currentConversationId);
localStorage.setItem('conversations', JSON.stringify(conversations));

if (conversations.length > 0) {
    loadConversation(conversations[0].id);
    updateConversationsList();
} else {
    startNewChat();
}

// Initialize right sidebar, play toggle and download button
document.getElementById('rightSidebarToggle').addEventListener('click', toggleRightSidebar);
document.getElementById('playToggle').addEventListener('click', toggleAutoContinue);
document.getElementById('summaryButton').addEventListener('click', showSummaryModal);

async function showSummaryModal() {
    const modal = document.getElementById('summaryModal');
    const summaryLoading = document.querySelector('.summary-loading');
    const summaryText = document.getElementById('summaryText');
    
    // Check for existing summary
    const conversation = conversations.find(c => c.id === currentConversationId);
    const existingSummary = conversation?.summary;
    
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('show'));

    try {
        // Fetch available models
        const response = await fetch(`${backendUrl}/api/tags`);
        const data = await response.json();
        
        // Update model dropdown
        const summaryModelSelect = document.getElementById('summaryModel');
        summaryModelSelect.innerHTML = data.models.map(model => 
            `<option value="${model.name}">${model.name}</option>`
        ).join('');
        
        // Set previously selected model if it exists
        if (summarySettings.model) {
            summaryModelSelect.value = summarySettings.model;
        } else if (data.models.length > 0) {
            // Set first available model as default
            summarySettings.model = data.models[0].name;
            summaryModelSelect.value = data.models[0].name;
            localStorage.setItem('summarySettings', JSON.stringify(summarySettings));
        }
    } catch (error) {
        console.error('Error loading models:', error);
        showAlert('Error loading models for summary');
    }

    if (existingSummary) {
        summaryLoading.style.display = 'none';
        summaryText.style.display = 'block';
        summaryText.textContent = existingSummary;
    } else {
        summaryLoading.style.display = 'block';
        summaryText.style.display = 'none';
        generateSummary();
    }
}

function closeSummaryModal() {
    const modal = document.getElementById('summaryModal');
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 300);
}

async function copyToClipboard(button, text) {
    try {
        await navigator.clipboard.writeText(text);
        const icon = button.querySelector('.material-icons');
        icon.textContent = 'check';
        setTimeout(() => {
            icon.textContent = 'content_copy';
        }, 2000);
    } catch (err) {
        console.error('Failed to copy text:', err);
    }
}

function downloadSummary() {
    const summaryText = document.getElementById('summaryText').textContent;
    const blob = new Blob([summaryText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'conversation-summary.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function generateSummary(messages = chatHistory, updateUI = true) {
    const summaryProgress = document.getElementById('summaryProgress');
    const summaryTotal = document.getElementById('summaryTotal');
    const summaryText = document.getElementById('summaryText');
    
    if (!summarySettings.model) {
        // Set first available model as default
        try {
            const response = await fetch(`${backendUrl}/api/tags`);
            const data = await response.json();
            if (data.models.length > 0) {
                summarySettings.model = data.models[0].name;
                localStorage.setItem('summarySettings', JSON.stringify(summarySettings));
            }
        } catch (error) {
            console.error('Error fetching models:', error);
            showAlert('Error fetching models for summary');
            closeSummaryModal();
            return;
        }
    }

    const windowSize = summarySettings.windowSize || 5;
    const totalMessages = chatHistory.length;
    summaryTotal.textContent = totalMessages;

    let summarizedText = '';
    for (let i = 0; i < totalMessages; i += windowSize) {
        summaryProgress.textContent = Math.min(i + windowSize, totalMessages);
        
        const windowMessages = chatHistory.slice(i, i + windowSize);
        const windowText = windowMessages.map(msg => 
            `${msg.role}: ${msg.content}`
        ).join('\n');

        try {
            const response = await fetch(`${backendUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: summarySettings.model,
                    prompt: `Summarize this conversation segment concisely:\n\n${windowText}\n\nSummary:`,
                    temperature: 0.7,
                    stream: false
                })
            });

            if (!response.ok) throw new Error('Summary generation failed');
            
            const result = await response.json();
            summarizedText += result.response + '\n\n';
            
            // Update the visible summary as we go
            summaryText.style.display = 'block';
            summaryText.textContent = summarizedText;
        } catch (error) {
            console.error('Error generating summary:', error);
            showAlert('Error generating summary');
            closeSummaryModal();
            return;
        }
    }

    currentSummary = summarizedText;
    
    // Store summary in conversation object
    if (currentConversationId) {
        const conversation = conversations.find(c => c.id === currentConversationId);
        if (conversation) {
            conversation.summary = summarizedText;
            localStorage.setItem('conversations', JSON.stringify(conversations));
        }
    }
    
    if (updateUI) {
        document.querySelector('.summary-loading').style.display = 'none';
    }
    
    return summarizedText;
}

async function saveSummarySettings() {
    const model = document.getElementById('summaryModel').value;
    const windowSize = parseInt(document.getElementById('summaryWindow').value) || 5;
    
    summarySettings = { model, windowSize };
    localStorage.setItem('summarySettings', JSON.stringify(summarySettings));
    
    // Clear existing summary since settings changed
    currentSummary = '';
    
    showAlert('Summary settings saved');
}
function convertToMarkdown(conversation) {
    let markdown = `# ${conversation.title}\n\n`;
    markdown += `Date: ${new Date(conversation.id).toLocaleString()}\n\n`;
    
    conversation.messages.forEach(msg => {
        if (msg.role === 'Human') {
            markdown += `**Human**: ${msg.content}\n\n`;
        } else {
            markdown += `**${msg.role}** (${msg.avatar}): ${msg.content}\n\n`;
        }
    });
    
    return markdown;
}

// Add click handler for download button
document.addEventListener('DOMContentLoaded', function() {
    const downloadBtn = document.getElementById('downloadButton');
    const dropdown = document.getElementById('downloadDropdown');
    
    downloadBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        dropdown.classList.toggle('show');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
        if (!dropdown.contains(e.target) && !downloadBtn.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });
});

function downloadConversation(format) {
    // Hide dropdown after selection
    document.getElementById('downloadDropdown').classList.remove('show');
    // Get current conversation
    const conversation = conversations.find(conv => conv.id === currentConversationId);
    if (!conversation) return;
    
    let content, type, extension;
    
    if (format === 'json') {
        const exportData = {
            title: conversation.title,
            date: new Date(conversation.id).toISOString(),
            messages: conversation.messages
        };
        content = JSON.stringify(exportData, null, 2);
        type = 'application/json';
        extension = 'json';
    } else {
        content = convertToMarkdown(conversation);
        type = 'text/markdown';
        extension = 'md';
    }
    
    // Create blob and download
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${conversation.title.toLowerCase().replace(/\s+/g, '-')}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
updatePersonasList();

function toggleAutoContinue() {
    const button = document.getElementById('playToggle');
    const icon = button.querySelector('.material-icons');
    
    autoContinue = !autoContinue;
    
    // Update button appearance
    if (autoContinue) {
        icon.textContent = 'stop';
        button.classList.add('active');
        // Start the conversation loop if it's not already running
        if (chatHistory.length > 0) {
            generateResponse(true);
        }
    } else {
        icon.textContent = 'play_arrow';
        button.classList.remove('active');
        // Reset remainingPersonas when stopping
        remainingPersonas = [];
    }
}

// Add this function to handle model selection changes
function showAlert(message) {
    const modal = document.getElementById('alertModal');
    const messageElement = document.getElementById('alertMessage');
    messageElement.textContent = message;
    
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('show'));
}

function closeAlertModal() {
    const modal = document.getElementById('alertModal');
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 300);
}

function handleModelChange() {
    const modelSelect = document.getElementById('modelList');
    const imageUploadBtn = document.getElementById('imageUpload');
    const imagePreview = document.getElementById('imagePreview');
    
    // Show image upload button only for llama3.2-vision model
    if (modelSelect.value === 'llama3.2-vision:latest') {
        imageUploadBtn.style.display = 'block';
    } else {
        // Hide button and clear any selected image for other models
        imageUploadBtn.style.display = 'none';
        selectedImage = null;
        imagePreview.innerHTML = '';
    }
} 
