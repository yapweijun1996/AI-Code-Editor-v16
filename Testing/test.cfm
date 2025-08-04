<cfset greeting = "Hello, World!">

<!--- This is a simple ColdFusion test file --->
<html>
<head>
    <title>ColdFusion Test</title>
</head>
<body>
    <h1><cfoutput>#greeting#</cfoutput></h1>
    <p>This is a test file to verify the fix for handling ColdFusion files.</p>
    
    <cfscript>
        // Some ColdFusion script code
        function sayHello(name) {
            return "Hello, " & name & "!";
        }
        
        numbers = [1, 2, 3, 4, 5];
        sum = 0;
        
        for (i = 1; i <= arrayLen(numbers); i++) {
            sum += numbers[i];
        }
    </cfscript>
    
    <p>Sum of numbers: <cfoutput>#sum#</cfoutput></p>
</body>
</html>