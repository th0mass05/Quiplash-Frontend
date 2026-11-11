var socket = null;

//Prepare game
var app = new Vue({
    el: '#game',
    data: {
        connected: false,
        messages: [],
        chatmessage: '',

        username: '',
        password: '',
        registerMessage: '',
        loginMessage: '',

        phase: '',
        round: 0,
        player: null,
        players: [],
        audience: [],
        audienceCount: 0,

        errorMsg: '',

        joinUrl: window.location.origin + '/',

        promptText: '',
        promptTags: '',
        promptMessage: ''

    },
    mounted: function() {
        connect(); 
    },
    methods: {
        handleChat(message) {
            if(this.messages.length + 1 > 10) {
                this.messages.pop();
            }
            this.messages.unshift(message);
        },
        chat() {
            socket.emit('chat',this.chatmessage);
            this.chatmessage = '';
        },

        register() {
            this.registerMessage = "Registering...";
            socket.emit("register", {username: this.username, password: this.password});
        },

        login() {
            this.loginMessage = "Logging in...";
            socket.emit("login", {username: this.username, password: this.password});
        },

        next() {
            this.errorMsg = "";
            socket.emit("next");
        },

        submitPrompt() {
            const tagInputs = this.promptTags.split(",").map((x) => x.trim())
            this.promptMessage = "Submitting prompt...";
            socket.emit("prompt", {text: this.promptText, tags: tagInputs})
        }
    }
});

function connect() {
    //Prepare web socket
    socket = io();

    //Connect
    socket.on('connect', function() {
        //Set connected state to true
        app.connected = true;
    });

    //Handle connection error
    socket.on('connect_error', function(message) {
        alert('Unable to connect: ' + message);
    });

    //Handle disconnection
    socket.on('disconnect', function() {
        alert('Disconnected');
        app.connected = false;
    });

    //Handle incoming chat message
    socket.on('chat', function(message) {
        app.handleChat(message);
    });

    socket.on("register-response", function(response) {
        app.registerMessage = response.data.msg;
    });

    socket.on("login-response", function(response) {
        app.loginMessage = response.data.msg;
    });

    socket.on("player-update", function(state) {
        app.phase = state.phase;
        app.round = state.round;
        app.player = state.player;
    });

    socket.on("error", function(data) {
        app.errorMsg = data.msg;
    });

    socket.on("game-update", function(state) {
        app.phase = state.phase;
        app.round = state.round;
        app.players = state.players || [];
        app.audienceCount = state.audienceCount || 0;
    });

    socket.on("prompt-response", function(response) {
        app.promptMessage = response.data.msg;
    });

}
