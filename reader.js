const fs = require('fs');
const convert = require('xml-js');

const main = (file) => {
    const qvd = fs.readFileSync(file, null);
    
    // header es el objeto obtenido de leer el xml
    // finH es el indice donde termina el xml
    // a partir de ahi se leerán las tablas de simbolos
    const {header, finH} = getHeader(qvd);
    // console.log(JSON.stringify(header));
    // console.log(finH);
    const dataBrt = qvd.slice(finH, qvd.length);
    // Buscando el inicio del area de datos
    // Despues de la etiqueta de cierre "</QvdTableHeader>" se encuentran caracteres basura
    // Estos caracteres pueden ser \r \n \0, luego de estos caracteres se encuentra la tabla de datos y simbolos
    let iniData = 0;
    let char = String.fromCharCode(dataBrt[iniData]);
    while(char === '\r' || char === '\n' || char === '\0')
    {
        iniData++;
        char = String.fromCharCode(dataBrt[iniData]);
    }
    // Inicio de la tabla de datos
    const data = dataBrt.slice(iniData, dataBrt.length);
    // console.log(header);
    const simbolos = [];
    for(const campo of header.campos)
    {
        // console.log(header.campos);
        simbolos.push(getSymbolTable(campo.offset, campo.offset + campo.length, data));
    }
    // console.log(simbolos);
    // const tabla = getSymbolTable(header.campos[4].offset, header.campos[4].offset + header.campos[4].length, data);
    // console.log(tabla);
    const idxTable = getIndexTable(header, data, header.rows.offset, header.rows.length);

    return toObject(simbolos, idxTable, header.campos);
}

const toObject = (symbols, indices, fields) => {
    const tab = [];
    const fieldArr = fields.map(itm => itm.field.replace(/\s/gm, '_'));

    for(let i = 0; i < indices.length; i++)
    {
        const row = indices[i];
        // const ob = [];
        const no = {};
        for(let j = 0; j < fields.length; j++)
        {
            no[fieldArr[j]] = row[j] < 0 ? null : symbols[j][row[j]];
        }
        tab.push(no);
    }
    return tab;
}

const getIndexTable = (header, buff, start, length) => {
    const rb = header.rows.recordByteSize;
    const rows = [];
    // Cada renglon consiste en n bytes, donde n = recordByteSize
    const le = header.campos.map(itm => itm.bitWidth);
    for(let i = start; i < start + length; i+= rb)
    {
        const arrow = new Int32Array(buff.slice(i, i + (rb)));
        // console.log(arrow);
        let row = bytesToInt32(arrow);
        const mask = (-1 >>> 0);
        // console.log('Idx ' + (row >>> 0).toString(2));
        // Lectura de los indices de cada campo
        const campos = [];
        for(let k = 0; k < header.campos.length; k++)
        {
            let result = 0;
            if(header.campos[k].bitWidth === 0)
                result = 0;
            else
            {
                // 32 es la longitud en bits de la mascara
                result = (mask >>> (32 - le[k])) & row;
                // Debug de la mascara y el numero
                // console.log('Mascara ' + ((mask >>> (rb*8 - le[k])) >>> 0).toString(2));
                // console.log((result >>> 0).toString(2));
                row = row >>> le[k];
                // console.log(result);
            }
            result += header.campos[k].bias;
            campos.push(result);
        }
        rows.push(campos);
    }
    return rows;
}

const getSymbolTable = (start, end, buff) => {
    // Para leer la tabla de simbolos es necesario tener en cuenta las consideraciones siguientes
    // Un simbolo es una secuencia de bytes
    // El primer byte contiene el tipo de valor
    // [Opcional] los siguientes 4 u 8 bytes contienen el valor en binario (Entero o float)
    // [Opcional] String utf-8 terminada en cero

    // One symbol (one column value) is the sequence of bytes:
    // first byte contains value type
    // [optional] next 4 or 8 bytes contain binary value (integer or float)
    // [optional] zero terminated utf-8 string

    // Existen 5 tipos de valores:
    // 1 es int (4 bytes)
    // 2 es double (8 bytes)
    // 4 es string (terminado en cero)
    // 5 es int (4 bytes) y string (terminado en 0)
    // 6 es double (8 bytes) y string (terminado en 0)

    const resultado = [];

    // Lectura de los datos
    for(let j = start; j < end; j++)
    {
        // Leer el tipo
        const tipo = buff[j];
        // Avanzar al siguiente byte
        j++;
        switch(tipo)
        {
            case 1:
                // Numeros enteros con signo
                const arTmp = new Int32Array(buff.slice(j, j + 4));
                j+=3;
                resultado.push(bytesToInt32(arTmp));
                break;
            case 2:
                // Numeros dobles 8 bytes
                const arrDob = new Int32Array(buff.slice(j, j + 8));
                resultado.push(bytesToDouble(arrDob));
                j+=7;
                break;
            case 4:
                // Lectura de strings
                // Avanzar en el arreglo (evitar el numero que indica el tipo)
                // Crear una variable con un string vacio
                let dato = '';
                // Si se llega al final del string terminar de concatenar
                while(buff[j] !== 0)
                {
                    // Concatenar el string y avanzar en el arreglo al siguiente string
                    dato+=String.fromCharCode(buff[j]);
                    j++;
                }
                // Mostrando el resultado del string
                resultado.push(dato);
                break;
            case 5:
                const arTmp2 = new Int32Array(buff.slice(j, j+4));
                j+=4;
                resultado.push(bytesToInt32(arTmp2));
                let dato2 = '';
                // Si se llega al final del string terminar de leer
                while(buff[j] !== 0)
                    j++;
                break;
            case 6:
                // Numeros dobles 8 bytes + string
                const arrDob2 = new Int32Array(buff.slice(j, j + 8));
                resultado.push(bytesToDouble(arrDob2));
                j+=8;
                // let dDoble = '';
                while(buff[j] !== 0)
                {
                    // dDoble+=String.fromCharCode(buff[j]);
                    j++;
                }
                // console.log(dDoble);
                // resultado.push(parseFloat(dDoble));
                break;
            default:
                console.log('ERROR, TIPO NO VALIDO');
                break;
        }
    }
    
    return resultado;
}

const bytesToInt32 = (arr) => {
    const buff = Buffer.from(arr);
    return buff.readIntLE(0, arr.length);
}

const bytesToDouble = (arr) => {
    const buff = Buffer.from(arr);
    return buff.readDoubleLE(0);
}

const getHeader = (buff) => {
    // Etiqueta de cierre del xml
    const etiFinal = '</QvdTableHeader>';
    // Indice final del xml
    const xmlFIndex = buff.indexOf(etiFinal,0,'utf-8') + etiFinal.length;
    // Obteniendo el xml
    const bufxml = buff.slice(0,xmlFIndex);
    const brtObj = convert.xml2js(bufxml.toString('utf-8'), {compact: true, spaces: 4});
    const {QvdTableHeader: xml} = brtObj; 
    const header = {
        app: xml.CreatorDoc._text,
        fecha_creacion_utc: xml.CreateUtcTime._text,
        nombre: xml.TableName._text,
        registros: xml.NoOfRecords._text,
        campos: [],
        rows:{
            recordByteSize: parseInt(xml.RecordByteSize._text),
            noRecords: parseInt(xml.NoOfRecords._text),
            offset: parseInt(xml.Offset._text),
            length: parseInt(xml.Length._text)
        }
    };
    const campos = xml.Fields.QvdFieldHeader.map(itm => {
        const nOb = {};
        nOb.field = itm.FieldName._text;
        nOb.bitOffset = parseInt(itm.BitOffset._text);
        nOb.bitWidth = parseInt(itm.BitWidth._text);
        nOb.bias = parseInt(itm.Bias._text);
        nOb.noSymbols = parseInt(itm.NoOfSymbols._text);
        nOb.offset = parseInt(itm.Offset._text);
        nOb.length = parseInt(itm.Length._text);
        return nOb;
    })

    header.campos = campos;
    const ret = {header: header, finH: xmlFIndex};
    return ret;
}

const QVD = {
    read: main
}

module.exports = QVD;
